import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotAcceptableException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { OrganizationsService } from './organizations.service';
import { JwtService } from '@nestjs/jwt';
import { User } from '../entities/user.entity';
import { UserSessions } from '../entities/user_sessions.entity';
import { OrganizationUsersService } from './organization_users.service';
import { EmailService } from './email.service';
import { decamelizeKeys } from 'humps';
import { Organization } from 'src/entities/organization.entity';
import { ConfigService } from '@nestjs/config';
import { SSOConfigs } from 'src/entities/sso_config.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';
import { OrganizationUser } from 'src/entities/organization_user.entity';
import { CreateAdminDto, CreateUserDto } from '@dto/user.dto';
import { AcceptInviteDto } from '@dto/accept-organization-invite.dto';
import {
  dbTransactionWrap,
  fullName,
  generateInviteURL,
  generateNextNameAndSlug,
  generateOrgInviteURL,
  isValidDomain,
} from 'src/helpers/utils.helper';
import {
  getUserErrorMessages,
  getUserStatusAndSource,
  isPasswordMandatory,
  USER_STATUS,
  lifecycleEvents,
  SOURCE,
  URL_SSO_SOURCE,
  WORKSPACE_USER_STATUS,
} from 'src/helpers/user_lifecycle';
import { MetadataService } from './metadata.service';
import { CookieOptions, Response } from 'express';
import { SessionService } from './session.service';
import { RequestContext } from 'src/models/request-context.model';
import * as requestIp from 'request-ip';
import { ActivateAccountWithTokenDto } from '@dto/activate-account-with-token.dto';
import { AppAuthenticationDto, AppSignupDto } from '@dto/app-authentication.dto';
import { SIGNUP_ERRORS } from 'src/helpers/errors.constants';
const bcrypt = require('bcrypt');
const uuid = require('uuid');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(OrganizationUser)
    private organizationUsersRepository: Repository<OrganizationUser>,
    private usersService: UsersService,
    private jwtService: JwtService,
    private organizationsService: OrganizationsService,
    private organizationUsersService: OrganizationUsersService,
    private emailService: EmailService,
    private metadataService: MetadataService,
    private configService: ConfigService,
    private sessionService: SessionService
  ) {}

  verifyToken(token: string) {
    try {
      const signedJwt = this.jwtService.verify(token);
      return signedJwt;
    } catch (err) {
      return null;
    }
  }

  private async validateUser(email: string, password: string, organizationId?: string): Promise<User> {
    const user = await this.usersService.findByEmail(email, organizationId, WORKSPACE_USER_STATUS.ACTIVE);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== USER_STATUS.ACTIVE) {
      throw new UnauthorizedException(getUserErrorMessages(user.status));
    }

    const passwordRetryConfig = this.configService.get<string>('PASSWORD_RETRY_LIMIT');

    const passwordRetryAllowed = passwordRetryConfig ? parseInt(passwordRetryConfig) : 5;

    if (
      this.configService.get<string>('DISABLE_PASSWORD_RETRY_LIMIT') !== 'true' &&
      user.passwordRetryCount >= passwordRetryAllowed
    ) {
      throw new UnauthorizedException(
        'Maximum password retry limit reached, please reset your password using forgot password option'
      );
    }
    if (!(await bcrypt.compare(password, user.password))) {
      await this.usersService.updateUser(user.id, { passwordRetryCount: user.passwordRetryCount + 1 });
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(response: Response, appAuthDto: AppAuthenticationDto, organizationId?: string, loggedInUser?: User) {
    let organization: Organization;
    const { email, password, redirectTo } = appAuthDto;

    const user = await this.validateUser(email, password, organizationId);

    return await dbTransactionWrap(async (manager: EntityManager) => {
      if (!organizationId) {
        // Global login
        // Determine the organization to be loaded

        const organizationList: Organization[] = await this.organizationsService.findOrganizationWithLoginSupport(
          user,
          'form'
        );

        const defaultOrgDetails: Organization = organizationList?.find((og) => og.id === user.defaultOrganizationId);
        if (defaultOrgDetails) {
          // default organization form login enabled
          organization = defaultOrgDetails;
        } else if (organizationList?.length > 0) {
          // default organization form login not enabled, picking first one from form enabled list
          organization = organizationList[0];
        } else {
          const isInviteRedirect = redirectTo.startsWith('/organization-invitations/');
          // no form login enabled organization available for user - creating new one
          if (!isInviteRedirect) {
            const { name, slug } = generateNextNameAndSlug('My workspace');
            organization = await this.organizationsService.create(name, slug, user, manager);
          }
        }
        if (organization) user.organizationId = organization.id;
      } else {
        // organization specific login
        // No need to validate user status, validateUser() already covers it
        user.organizationId = organizationId;

        organization = await this.organizationsService.get(user.organizationId);
        const formConfigs: SSOConfigs = organization?.ssoConfigs?.find((sso) => sso.sso === 'form');

        if (!formConfigs?.enabled) {
          // no configurations in organization side or Form login disabled for the organization
          throw new UnauthorizedException('Password login is disabled for the organization');
        }
      }

      const shouldUpdateDefaultOrgId =
        user.defaultOrganizationId && user.organizationId && user.defaultOrganizationId !== user.organizationId;
      const updateData = {
        ...(shouldUpdateDefaultOrgId && { defaultOrganizationId: organization.id }),
        passwordRetryCount: 0,
      };

      await this.usersService.updateUser(user.id, updateData, manager);

      return await this.generateLoginResultPayload(response, user, organization, false, true, loggedInUser);
    });
  }

  async switchOrganization(response: Response, newOrganizationId: string, user: User, isNewOrganization?: boolean) {
    if (!(isNewOrganization || user.isPasswordLogin || user.isSSOLogin)) {
      throw new UnauthorizedException();
    }
    const newUser = await this.usersService.findByEmail(user.email, newOrganizationId, WORKSPACE_USER_STATUS.ACTIVE);

    /* User doesn't have access to this workspace */
    if (!newUser) {
      throw new UnauthorizedException("User doesn't have access to this workspace");
    }
    newUser.organizationId = newOrganizationId;

    const organization: Organization = await this.organizationsService.get(newUser.organizationId);

    const formConfigs: SSOConfigs = organization?.ssoConfigs?.find((sso) => sso.sso === 'form');

    if ((user.isPasswordLogin && !formConfigs?.enabled) || (user.isSSOLogin && !organization.inheritSSO)) {
      // no configurations in organization side or Form login disabled for the organization
      throw new UnauthorizedException('Please log in to continue');
    }

    return await dbTransactionWrap(async (manager: EntityManager) => {
      // Updating default organization Id
      await this.usersService.updateUser(newUser.id, { defaultOrganizationId: newUser.organizationId }, manager);

      return await this.generateLoginResultPayload(
        response,
        user,
        organization,
        user.isSSOLogin,
        user.isPasswordLogin,
        user
      );
    });
  }

  async authorizeOrganization(user: User) {
    return await dbTransactionWrap(async (manager: EntityManager) => {
      if (user.defaultOrganizationId !== user.organizationId)
        await this.usersService.updateUser(user.id, { defaultOrganizationId: user.organizationId }, manager);

      const organization = await this.organizationsService.get(user.organizationId);

      return decamelizeKeys({
        currentOrganizationId: user.organizationId,
        currentOrganizationSlug: organization.slug,
        admin: await this.usersService.hasGroup(user, 'admin', null, manager),
        groupPermissions: await this.usersService.groupPermissions(user, manager),
        appGroupPermissions: await this.usersService.appGroupPermissions(user, null, manager),
        currentUser: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarId: user.avatarId,
        },
      });
    });
  }

  async resendEmail(email: string) {
    if (!email) {
      throw new BadRequestException();
    }
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser?.organizationUsers?.some((ou) => ou.status === WORKSPACE_USER_STATUS.ACTIVE)) {
      throw new NotAcceptableException('Email already exists');
    }

    if (existingUser?.invitationToken) {
      this.emailService
        .sendWelcomeEmail(existingUser.email, existingUser.firstName, existingUser.invitationToken)
        .catch((err) => console.error(err));
      return;
    }
  }

  async signup(appSignUpDto: AppSignupDto, response: Response) {
    const { name, email, password, organizationId } = appSignUpDto;

    // Check if the configs allows user signups
    if (this.configService.get<string>('DISABLE_SIGNUPS') === 'true') {
      throw new NotAcceptableException();
    }

    const existingUser = await this.usersService.findByEmail(email);
    let signingUpOrganization: Organization;

    if (organizationId) {
      signingUpOrganization = await this.organizationsService.get(organizationId);
      if (!signingUpOrganization) {
        throw new NotFoundException('Could not found organization details. Please verify the orgnization id');
      }
      /* Check if the workspace allows user signup or not */
      const { enableSignUp, domain } = signingUpOrganization;
      if (!enableSignUp) {
        throw new ForbiddenException('Workspace signup has been disabled. Please contact the workspace admin.');
      }
      if (!isValidDomain(email, domain)) {
        throw new ForbiddenException('You cannot sign up using the email address - Domain verification failed.');
      }
    }

    const names = { firstName: '', lastName: '' };
    if (name) {
      const [firstName, ...rest] = name.split(' ');
      names['firstName'] = firstName;
      if (rest.length != 0) {
        const lastName = rest.join(' ');
        names['lastName'] = lastName;
      }
    }
    const { firstName, lastName } = names;
    const userParams = { email, password, firstName, lastName };

    if (existingUser) {
      return await this.whatIfTheSignUpIsAtTheWorkspaceLevel(existingUser, signingUpOrganization, userParams, response);
    } else {
      return await this.createUserOrPersonalWorkspace(userParams, existingUser, signingUpOrganization, response);
    }
  }

  createUserOrPersonalWorkspace = async (
    userParams: { email: string; password: string; firstName: string; lastName: string },
    existingUser: User,
    signingUpOrganization: Organization = null,
    response?: Response
  ) => {
    return await dbTransactionWrap(async (manager: EntityManager) => {
      const { email, password, firstName, lastName } = userParams;
      let organization = signingUpOrganization;
      if (!signingUpOrganization) {
        /* No organization signup - Create personal workspace for the user */
        const { name, slug } = generateNextNameAndSlug('My workspace');
        organization = await this.organizationsService.create(name, slug, null, manager);
      }
      const groups = !signingUpOrganization ? ['all_users', 'admin'] : ['all_users'];
      const user = await this.usersService.create(
        {
          email,
          password,
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(signingUpOrganization
            ? getUserStatusAndSource(lifecycleEvents.USER_SIGNUP_ACTIVATE)
            : getUserStatusAndSource(lifecycleEvents.USER_SIGN_UP)),
        },
        organization.id,
        groups,
        existingUser,
        !signingUpOrganization,
        null,
        manager
      );
      const organizationUser = await this.organizationUsersService.create(user, organization, true, manager);
      if (signingUpOrganization) {
        return this.processOrganizationSignup(
          response,
          user,
          { invitationToken: organizationUser.invitationToken, organizationId: organization.id },
          manager
        );
      } else {
        if (existingUser) {
          /* Invite user doing instance signup. So reset name fields and set password */
          await this.usersService.updateUser(
            existingUser.id,
            {
              ...(firstName && { firstName }),
              lastName: lastName ?? '',
              defaultOrganizationId: organization.id,
              password,
              source: SOURCE.SIGNUP,
            },
            manager
          );
        }
        this.emailService
          .sendWelcomeEmail(user.email, user.firstName, user.invitationToken)
          .catch((err) => console.error(err));
        return {};
      }
    });
  };

  async processOrganizationSignup(
    response: Response,
    user: User,
    organizationParams: Partial<OrganizationUser>,
    manager?: EntityManager,
    defaultOrganization = null
  ) {
    const { invitationToken, organizationId } = organizationParams;
    /* Active user want to signup to the organization case */
    const session = defaultOrganization
      ? await this.generateLoginResultPayload(response, user, defaultOrganization, false, true, null, manager)
      : await this.generateInviteSignupPayload(response, user, 'signup', manager);
    const organizationInviteUrl = generateOrgInviteURL(invitationToken, organizationId, false);
    return { ...session, organizationInviteUrl };
  }

  sendOrgInvite = (
    userParams: { email: string; firstName: string },
    signingUpOrganizationName: string,
    invitationToken = null,
    throwError = true
  ) => {
    this.emailService
      .sendOrganizationUserWelcomeEmail(
        userParams.email,
        userParams.firstName,
        null,
        invitationToken,
        signingUpOrganizationName
      )
      .catch((err) => console.error(err));
    if (throwError) {
      throw new NotAcceptableException(
        'The user is already registered. Please check your inbox for the activation link'
      );
    } else {
      return {};
    }
  };

  whatIfTheSignUpIsAtTheWorkspaceLevel = async (
    existingUser: User,
    signingUpOrganization: Organization,
    userParams: { firstName: string; lastName: string; password: string },
    response: Response
  ) => {
    const { firstName, lastName, password } = userParams;
    const organizationId: string = signingUpOrganization?.id;
    const organizationUsers = existingUser.organizationUsers;
    const alreadyInvitedUserByAdmin = organizationUsers.find(
      (organizationUser: OrganizationUser) =>
        organizationUser.organizationId === organizationId && organizationUser.status === WORKSPACE_USER_STATUS.INVITED
    );
    const hasActiveWorkspaces = organizationUsers.some(
      (organizationUser: OrganizationUser) => organizationUser.status === WORKSPACE_USER_STATUS.ACTIVE
    );
    const hasSomeWorkspaceInvites = organizationUsers.some(
      (organizationUser: OrganizationUser) => organizationUser.status === WORKSPACE_USER_STATUS.INVITED
    );
    const isAlreadyActiveInWorkspace = organizationUsers.find(
      (organizationUser: OrganizationUser) =>
        organizationUser.organizationId === organizationId && organizationUser.status === WORKSPACE_USER_STATUS.ACTIVE
    );

    /* User who missed the organization invite flow  */
    const activeAccountButnotActiveInWorkspaces = !!alreadyInvitedUserByAdmin && !existingUser.invitationToken;
    const invitedButNotActivated = !!alreadyInvitedUserByAdmin && !!existingUser.invitationToken;
    const activeUserWantsToSignUpToWorkspace = hasActiveWorkspaces && !!organizationId && !isAlreadyActiveInWorkspace;
    const personalWorkspaceCount = await this.organizationUsersService.personalWorkspaceCount(existingUser.id);
    const didInstanceSignUpAlreadyButNotActive = !!existingUser?.invitationToken && personalWorkspaceCount > 0;
    const activatedAccountNoActiveWorkspaces = !existingUser?.invitationToken && hasSomeWorkspaceInvites;
    /* Personal workspace case */
    const adminInvitedButUserWantsInstanceSignup = !!existingUser?.invitationToken && hasSomeWorkspaceInvites;
    const isUserAlreadyExisted = !!isAlreadyActiveInWorkspace || hasActiveWorkspaces;

    switch (true) {
      case invitedButNotActivated: {
        /* 
               Organization Signup and admin already send an invite to the user
               activate account and send org invite url 
            */
        await this.usersService.updateUser(existingUser.id, {
          invitationToken: null,
          password,
          ...(firstName && {
            firstName,
          }) /* we should reset the name if the user is not activated his account before */,
          lastName: lastName ?? '',
          ...getUserStatusAndSource(lifecycleEvents.USER_REDEEM),
        });
        return await this.processOrganizationSignup(response, existingUser, {
          invitationToken: alreadyInvitedUserByAdmin.invitationToken,
          organizationId,
        });
      }
      case activeAccountButnotActiveInWorkspaces: {
        /* Send the org invite again */
        this.sendOrgInvite(
          { email: existingUser.email, firstName },
          signingUpOrganization.name,
          alreadyInvitedUserByAdmin.invitationToken
        );
        break;
      }
      case activeUserWantsToSignUpToWorkspace: {
        /* Create new organizations_user entry and send an invite */
        return await dbTransactionWrap(async (manager: EntityManager) => {
          await this.usersService.attachUserGroup(['all_users'], organizationId, existingUser.id, manager);
          const organizationUser = await this.organizationUsersService.create(
            existingUser,
            signingUpOrganization,
            true,
            manager
          );
          const defaultOrganization = await this.organizationsService.fetchOrganization(
            existingUser.defaultOrganizationId
          );
          return await this.processOrganizationSignup(
            response,
            existingUser,
            {
              invitationToken: organizationUser.invitationToken,
              organizationId,
            },
            manager,
            defaultOrganization
          );
        });
        break;
      }
      case adminInvitedButUserWantsInstanceSignup: {
        if (personalWorkspaceCount === 0) {
          await this.createUserOrPersonalWorkspace(
            { email: existingUser.email, password, firstName, lastName },
            existingUser,
            null,
            response
          );
        } else {
          /* Update username and  password, resend the email */
          await this.usersService.updateUser(existingUser.id, {
            ...(firstName && { firstName }),
            lastName: lastName ?? '',
            password,
            source: SOURCE.SIGNUP,
          });
          this.emailService
            .sendWelcomeEmail(existingUser.email, existingUser.firstName, existingUser.invitationToken)
            .catch((err) => console.error(err));
        }

        break;
      }
      case activatedAccountNoActiveWorkspaces:
      case didInstanceSignUpAlreadyButNotActive: {
        /* Resend intance invitation */
        const errorMessage = organizationId
          ? 'Please finish setting up your account before signing in to this workspace. Check your inbox for the activation link.'
          : 'The user is already registered. Please check your inbox for the activation link';

        if (!organizationId) {
          const pickOneWorkspace = existingUser.organizationUsers.find(
            (ou) => ou.status === WORKSPACE_USER_STATUS.INVITED
          );
          if (pickOneWorkspace) {
            const signingUpOrganization = await this.organizationsService.fetchOrganization(
              pickOneWorkspace.organizationId
            );
            this.sendOrgInvite(
              { email: existingUser.email, firstName },
              signingUpOrganization.name,
              pickOneWorkspace.invitationToken
            );
          }
        }

        this.emailService
          .sendWelcomeEmail(existingUser.email, existingUser.firstName, existingUser.invitationToken)
          .catch((err) => console.error(err));
        throw new NotAcceptableException(errorMessage);
      }
      case isUserAlreadyExisted: {
        /* already an user of that workspace or user is trying signup again from instance signup page */
        const errorMessage = organizationId ? 'User already extsts in the workspace.' : 'Email already exists.';
        throw new NotAcceptableException(errorMessage);
      }
      default:
        break;
    }
  };

  async activateAccountWithToken(activateAccountWithToken: ActivateAccountWithTokenDto, response: any) {
    const { email, password, organizationToken } = activateAccountWithToken;
    const signupUser = await this.usersService.findByEmail(email);
    const invitedUser = await this.organizationUsersService.findByWorkspaceInviteToken(organizationToken);

    // Check if the configs allows user signups
    if (this.configService.get<string>('DISABLE_SIGNUPS') === 'true') {
      throw new NotAcceptableException('Signup has been disabled for this workspace. Please contact admin');
    }

    if (!signupUser || invitedUser.email !== signupUser.email) {
      const { type, message, inputError } = SIGNUP_ERRORS.INCORRECT_INVITED_EMAIL;
      const errorResponse = {
        message: {
          message,
          type,
          inputError,
        },
      };
      throw new NotAcceptableException(errorResponse);
    }

    if (signupUser?.organizationUsers?.some((ou) => ou.status === WORKSPACE_USER_STATUS.ACTIVE)) {
      throw new NotAcceptableException('Email already exists');
    }

    const lifecycleParams = getUserStatusAndSource(lifecycleEvents.USER_REDEEM, SOURCE.INVITE);

    return await dbTransactionWrap(async (manager: EntityManager) => {
      // Activate default workspace if user has one
      const defaultOrganizationUser: OrganizationUser = signupUser.organizationUsers.find(
        (ou) => ou.organizationId === signupUser.defaultOrganizationId
      );
      let defaultOrganization: Organization;
      if (defaultOrganizationUser) {
        await this.organizationUsersService.activateOrganization(defaultOrganizationUser, manager);
        defaultOrganization = await this.organizationsService.fetchOrganization(defaultOrganizationUser.organizationId);
      }

      await this.usersService.updateUser(
        signupUser.id,
        {
          password,
          invitationToken: null,
          ...(password ? { password } : {}),
          ...lifecycleParams,
          updatedAt: new Date(),
        },
        manager
      );

      /* 
        Generate org invite and send back to the client. Let him join to the workspace
        CASE: user redirected to signup to activate his account with password. 
        Till now user doesn't have an organization.
      */
      return this.processOrganizationSignup(
        response,
        signupUser,
        { invitationToken: organizationToken, organizationId: invitedUser['invitedOrganizationId'] },
        manager,
        defaultOrganization
      );
    });
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException('Email address not found');
    }
    const forgotPasswordToken = uuid.v4();
    await this.usersService.updateUser(user.id, { forgotPasswordToken });
    await this.emailService.sendPasswordResetEmail(email, forgotPasswordToken);
  }

  async resetPassword(token: string, password: string) {
    const user = await this.usersService.findByPasswordResetToken(token);
    if (!user) {
      throw new NotFoundException(
        'Invalid Reset Password URL. Please ensure you have the correct URL for resetting your password.'
      );
    } else {
      await this.usersService.updateUser(user.id, {
        password,
        forgotPasswordToken: null,
        passwordRetryCount: 0,
      });
    }
  }

  private splitName(name: string): { firstName: string; lastName: string } {
    const nameObj = { firstName: '', lastName: '' };
    if (name) {
      const [firstName, ...rest] = name.split(' ');
      nameObj.firstName = firstName;
      if (rest.length != 0) {
        nameObj.lastName = rest.join(' ');
      }
    }
    return nameObj;
  }

  async setupAdmin(response: Response, userCreateDto: CreateAdminDto): Promise<any> {
    const { companyName, companySize, name, role, workspace, password, email, phoneNumber } = userCreateDto;

    const nameObj = this.splitName(name);

    const result = await dbTransactionWrap(async (manager: EntityManager) => {
      // Create first organization
      const organization = await this.organizationsService.create(
        workspace || 'My workspace',
        'my-workspace',
        null,
        manager
      );
      const user = await this.usersService.create(
        {
          email,
          password,
          ...(nameObj.firstName && { firstName: nameObj.firstName }),
          ...(nameObj.lastName && { lastName: nameObj.lastName }),
          ...getUserStatusAndSource(lifecycleEvents.USER_ADMIN_SETUP),
          companyName,
          companySize,
          role,
          phoneNumber,
        },
        organization.id,
        ['all_users', 'admin'],
        null,
        false,
        null,
        manager
      );
      await this.organizationUsersService.create(user, organization, false, manager);
      return this.generateLoginResultPayload(response, user, organization, false, true, null, manager);
    });

    await this.metadataService.finishOnboarding(name, email, companyName, companySize, role);
    return result;
  }

  async setupAccountFromInvitationToken(response: Response, userCreateDto: CreateUserDto) {
    const {
      companyName,
      companySize,
      token,
      role,
      organizationToken,
      password: userPassword,
      source,
      phoneNumber,
    } = userCreateDto;
    let password = userPassword;

    if (!token) {
      throw new BadRequestException('Invalid token');
    }

    return await dbTransactionWrap(async (manager: EntityManager) => {
      const user: User = await manager.findOne(User, { where: { invitationToken: token } });
      let organizationUser: OrganizationUser;
      let isSSOVerify: boolean;

      if (organizationToken) {
        organizationUser = await manager.findOne(OrganizationUser, {
          where: { invitationToken: organizationToken },
          relations: ['user'],
        });
      }
      if (user?.organizationUsers) {
        if (!password && source === 'sso') {
          /* For SSO we don't need password. let us set uuid as a password. */
          password = uuid.v4();
        }

        if (isPasswordMandatory(user.source) && !password) {
          throw new BadRequestException('Please enter password');
        }
        // Getting default workspace
        const defaultOrganizationUser: OrganizationUser = user.organizationUsers.find(
          (ou) => ou.organizationId === user.defaultOrganizationId
        );

        if (!defaultOrganizationUser) {
          throw new BadRequestException('Invalid invitation link');
        }

        isSSOVerify = source === URL_SSO_SOURCE && (user.source === SOURCE.GOOGLE || user.source === SOURCE.GIT);

        const lifecycleParams = getUserStatusAndSource(
          isSSOVerify ? lifecycleEvents.USER_SSO_ACTIVATE : lifecycleEvents.USER_REDEEM,
          organizationUser ? SOURCE.INVITE : SOURCE.SIGNUP
        );

        await this.usersService.updateUser(
          user.id,
          {
            ...(role ? { role } : {}),
            companySize,
            companyName,
            phoneNumber,
            invitationToken: null,
            ...(isPasswordMandatory(user.source) ? { password } : {}),
            ...lifecycleParams,
            updatedAt: new Date(),
          },
          manager
        );

        // Activate default workspace
        await this.organizationUsersService.activateOrganization(defaultOrganizationUser, manager);
      } else {
        throw new BadRequestException('Invalid invitation link');
      }

      if (organizationUser) {
        // Activate invited workspace
        await this.organizationUsersService.activateOrganization(organizationUser, manager);

        // Setting this workspace as default one to load it
        await this.usersService.updateUser(
          organizationUser.user.id,
          { defaultOrganizationId: organizationUser.organizationId },
          manager
        );
      }

      const organization = await manager.findOne(Organization, {
        where: {
          id: organizationUser?.organizationId || user.defaultOrganizationId,
        },
      });

      const isInstanceSSOLogin = !organizationUser && isSSOVerify;

      return this.generateLoginResultPayload(response, user, organization, isInstanceSSOLogin, !isSSOVerify);
    });
  }

  async acceptOrganizationInvite(response: Response, loggedInUser: User, acceptInviteDto: AcceptInviteDto) {
    const { token } = acceptInviteDto;

    return await dbTransactionWrap(async (manager: EntityManager) => {
      const organizationUser = await manager.findOne(OrganizationUser, {
        where: { invitationToken: token },
        relations: ['user', 'organization'],
      });

      if (!organizationUser?.user) {
        throw new BadRequestException('Invalid invitation link');
      }
      const user: User = organizationUser.user;

      if (user.invitationToken) {
        // User sign up link send - not activated account
        this.emailService
          .sendWelcomeEmail(
            user.email,
            `${user.firstName} ${user.lastName} ?? ''`,
            user.invitationToken,
            `${organizationUser.invitationToken}`,
            organizationUser.organizationId
          )
          .catch((err) => console.error('Error while sending welcome mail', err));
        throw new UnauthorizedException(
          'Please setup your account using account setup link shared via email before accepting the invite'
        );
      }
      await this.usersService.updateUser(user.id, { defaultOrganizationId: organizationUser.organizationId }, manager);
      const organization = await this.organizationsService.get(organizationUser.organizationId);
      await this.organizationUsersService.activateOrganization(organizationUser, manager);
      return this.generateLoginResultPayload(response, user, organization, null, null, loggedInUser, manager);
    });
  }

  async verifyInviteToken(token: string, organizationToken?: string) {
    const user: User = await this.usersRepository.findOne({ where: { invitationToken: token } });
    let organizationUser: OrganizationUser;

    if (organizationToken) {
      organizationUser = await this.organizationUsersRepository.findOne({
        where: { invitationToken: organizationToken },
        relations: ['user'],
      });

      if (!user && organizationUser) {
        return {
          redirect_url: generateOrgInviteURL(organizationToken, organizationUser.organizationId),
        };
      } else if (user && !organizationUser) {
        return {
          redirect_url: generateInviteURL(token),
        };
      }
    }

    if (!user) {
      throw new BadRequestException('Invalid token');
    }

    if (user.status === USER_STATUS.ARCHIVED) {
      throw new BadRequestException(getUserErrorMessages(user.status));
    }

    await this.usersService.updateUser(user.id, getUserStatusAndSource(lifecycleEvents.USER_VERIFY, user.source));

    return {
      email: user.email,
      name: `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`,
      onboarding_details: {
        password: isPasswordMandatory(user.source), // Should accept password if user is setting up first time
        questions:
          (this.configService.get<string>('ENABLE_ONBOARDING_QUESTIONS_FOR_ALL_SIGN_UPS') === 'true' &&
            !organizationUser) || // Should ask onboarding questions if first user of the instance. If ENABLE_ONBOARDING_QUESTIONS_FOR_ALL_SIGN_UPS=true, then will ask questions to all signup users
          (await this.usersRepository.count({ where: { status: USER_STATUS.ACTIVE } })) === 0,
      },
    };
  }

  async verifyOrganizationToken(token: string) {
    const organizationUser: OrganizationUser = await this.organizationUsersRepository.findOne({
      where: { invitationToken: token },
      relations: ['user'],
    });

    const user: User = organizationUser?.user;
    if (!user) {
      throw new BadRequestException('Invalid token');
    }
    if (user.status !== USER_STATUS.ACTIVE) {
      throw new BadRequestException(getUserErrorMessages(user.status));
    }

    return {
      email: user.email,
      name: `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`,
      onboarding_details: {
        password: false, // Should not accept password for organization token
      },
    };
  }

  async generateSessionPayload(user: User, currentOrganization: Organization) {
    const currentOrganizationId = currentOrganization?.id
      ? currentOrganization?.id
      : user?.organizationIds?.includes(user?.defaultOrganizationId)
      ? user.defaultOrganizationId
      : user?.organizationIds?.[0];

    const activeWorkspacesCount = await this.organizationUsersService.getActiveWorkspacesCount(user.id);
    const noWorkspaceAttachedInTheSession = activeWorkspacesCount === 0;

    return decamelizeKeys({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      noWorkspaceAttachedInTheSession,
      currentOrganizationId,
      currentOrganizationSlug: currentOrganization?.slug,
    });
  }

  async generateLoginResultPayload(
    response: Response,
    user: User,
    organization: DeepPartial<Organization>,
    isInstanceSSO: boolean,
    isPasswordLogin: boolean,
    loggedInUser?: User,
    manager?: EntityManager
  ): Promise<any> {
    const request = RequestContext?.currentContext?.req;
    const organizationIds = new Set([
      ...(loggedInUser?.id === user.id ? loggedInUser?.organizationIds || [] : []),
      ...(organization ? [organization.id] : []),
    ]);
    let sessionId = loggedInUser?.sessionId;

    // logged in user and new user are different -> creating session
    if (loggedInUser?.id !== user.id) {
      const session: UserSessions = await this.sessionService.createSession(
        user.id,
        `IP: ${request?.clientIp || requestIp.getClientIp(request) || 'unknown'} UA: ${
          request?.headers['user-agent'] || 'unknown'
        }`,
        manager
      );
      sessionId = session.id;
    }

    const JWTPayload: JWTPayload = {
      sessionId: sessionId,
      username: user.id,
      sub: user.email,
      organizationIds: [...organizationIds],
      isSSOLogin: loggedInUser?.isSSOLogin || isInstanceSSO,
      isPasswordLogin: loggedInUser?.isPasswordLogin || isPasswordLogin,
    };

    if (organization) user.organizationId = organization.id;

    const cookieOptions: CookieOptions = {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 2 * 365 * 24 * 60 * 60 * 1000, // maximum expiry 2 years
    };

    if (this.configService.get<string>('ENABLE_PRIVATE_APP_EMBED') === 'true') {
      // disable cookie security
      cookieOptions.sameSite = 'none';
      cookieOptions.secure = true;
    }

    response.cookie('tj_auth_token', this.jwtService.sign(JWTPayload), cookieOptions);

    const responsePayload = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      ...(organization
        ? { currentOrganizationId: organization.id, currentOrganizationSlug: organization.slug }
        : { noWorkspaceAttachedInTheSession: true }),
    };

    return decamelizeKeys(responsePayload);
  }

  async validateInvitedUserSession(user: User, invitedUser: any, tokens: any) {
    const { accountToken, organizationToken } = tokens;
    const { status: invitedUserStatus, organizationStatus, invitedOrganizationId } = invitedUser;
    const organizationAndAccountInvite = !!organizationToken && !!accountToken;
    const accountYetToActive =
      organizationAndAccountInvite &&
      [USER_STATUS.INVITED, USER_STATUS.VERIFIED].includes(invitedUserStatus as USER_STATUS);
    const invitedOrganization = await this.organizationsService.fetchOrganization(invitedUser['invitedOrganizationId']);
    const { name: invitedOrganizationName, slug: invitedOrganizationSlug } = invitedOrganization;

    if (accountYetToActive) {
      const errorResponse = {
        message: {
          error: 'Account is not activated yet',
          isAccountNotActivated: true,
          inviteeEmail: invitedUser.email,
          redirectPath: `/signup/${invitedOrganizationSlug ?? invitedOrganizationId}`,
        },
      };
      throw new NotAcceptableException(errorResponse);
    }

    /* Send back the organization invite url if the user has old workspace + account invitation URL */
    const doesUserHaveWorkspaceAndAccountInvite =
      organizationAndAccountInvite &&
      [USER_STATUS.ACTIVE].includes(invitedUserStatus as USER_STATUS) &&
      organizationStatus === WORKSPACE_USER_STATUS.INVITED;
    const organizationInviteUrl = doesUserHaveWorkspaceAndAccountInvite
      ? generateOrgInviteURL(organizationToken, invitedOrganizationId, false)
      : null;

    const organzationId = user?.organizationId || user?.defaultOrganizationId;
    const activeOrganization = organzationId ? await this.organizationsService.fetchOrganization(organzationId) : null;
    const payload = await this.generateSessionPayload(user, activeOrganization);
    const responseObj = {
      ...payload,
      invitedOrganizationName,
      name: fullName(user['firstName'], user['lastName']),
      ...(organizationInviteUrl && { organizationInviteUrl }),
    };
    return decamelizeKeys(responseObj);
  }

  async generateInviteSignupPayload(
    response: Response,
    user: User,
    source: string,
    manager?: EntityManager
  ): Promise<any> {
    const request = RequestContext?.currentContext?.req;
    const { id, email, firstName, lastName } = user;

    const session: UserSessions = await this.sessionService.createSession(
      user.id,
      `IP: ${request?.clientIp || requestIp.getClientIp(request) || 'unknown'} UA: ${
        request?.headers['user-agent'] || 'unknown'
      }`,
      manager
    );
    const sessionId = session.id;

    const JWTPayload: JWTPayload = {
      sessionId,
      username: id,
      sub: email,
      organizationIds: [],
      isSSOLogin: source === 'sso',
      isPasswordLogin: source === 'signup',
    };

    const cookieOptions: CookieOptions = {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 2 * 365 * 24 * 60 * 60 * 1000, // maximum expiry 2 years
    };

    if (this.configService.get<string>('ENABLE_PRIVATE_APP_EMBED') === 'true') {
      // disable cookie security
      cookieOptions.sameSite = 'none';
      cookieOptions.secure = true;
    }
    response.cookie('tj_auth_token', this.jwtService.sign(JWTPayload), cookieOptions);

    return decamelizeKeys({
      id,
      email,
      firstName,
      lastName,
    });
  }
}

interface JWTPayload {
  sessionId: string;
  username: string;
  sub: string;
  organizationIds: Array<string>;
  isSSOLogin: boolean;
  isPasswordLogin: boolean;
}
