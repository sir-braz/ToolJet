import { appVersionService } from '@/_services';
import { create, zustandDevTools } from './utils';
import { shallow } from 'zustand/shallow';
import { useContext } from 'react';
import { useSuperStore } from './superStore';
import { ModuleContext } from '../_contexts/ModuleContext';

export function createAppDataStore(moduleName) {
  const initialState = {
    editingVersion: null,
    currentUser: null,
    apps: [],
    appName: null,
    slug: null,
    isPublic: null,
    isMaintenanceOn: null,
    organizationId: null,
    currentVersionId: null,
    userId: null,
    app: {},
    components: [],
    pages: [],
    layouts: [],
    events: [],
    eventHandlers: [],
    appDefinitionDiff: null,
    appDiffOptions: {},
    isSaving: false,
    appId: null,
    areOthersOnSameVersionAndPage: false,
    appVersionPreviewLink: null,
    moduleName,
  };
  return create(
    zustandDevTools(
      (set, get) => ({
        ...initialState,
        actions: {
          updateEditingVersion: (version) => set(() => ({ editingVersion: version })),
          updateApps: (apps) => set(() => ({ apps: apps })),
          updateState: (state) => set((prev) => ({ ...prev, ...state })),
          updateAppDefinitionDiff: (appDefinitionDiff) => set(() => ({ appDefinitionDiff: appDefinitionDiff })),
          updateAppVersion: (appId, versionId, pageId, appDefinitionDiff, isUserSwitchedVersion = false) => {
            return new Promise((resolve, reject) => {
              get().actions.setIsSaving(true);
              const isComponentCutProcess = get().appDiffOptions?.componentCut === true;

              appVersionService
                .autoSaveApp(
                  appId,
                  versionId,
                  appDefinitionDiff.updateDiff,
                  appDefinitionDiff.type,
                  pageId,
                  appDefinitionDiff.operation,
                  isUserSwitchedVersion,
                  isComponentCutProcess
                )
                .then(() => {
                  get().actions.setIsSaving(false);
                })
                .catch((error) => {
                  get().actions.setIsSaving(false);
                  reject(error);
                })
                .finally(() => resolve());
            });
          },
          updateAppVersionEventHandlers: async (events, updateType = 'update') => {
            get().actions.setIsSaving(true);
            const appId = get().appId;
            const versionId = get().currentVersionId;

            const response = await appVersionService.saveAppVersionEventHandlers(appId, versionId, events, updateType);

            get().actions.setIsSaving(false);
            const updatedEvents = get().events;

            updatedEvents.forEach((e, index) => {
              const toUpdate = response.find((r) => r.id === e.id);
              if (toUpdate) {
                updatedEvents[index] = toUpdate;
              }
            });

            set(() => ({ events: updatedEvents }));
          },

          createAppVersionEventHandlers: async (event) => {
            get().actions.setIsSaving(true);
            const appId = get().appId;
            const versionId = get().currentVersionId;

            const updatedEvents = get().events;
            const response = await appVersionService.createAppVersionEventHandler(appId, versionId, event);
            get().actions.setIsSaving(false);
            updatedEvents.push(response);

            set(() => ({ events: updatedEvents }));
          },

          deleteAppVersionEventHandler: async (eventId) => {
            get().actions.setIsSaving(true);
            const appId = get().appId;
            const versionId = get().currentVersionId;

            const updatedEvents = get().events;

            const response = await appVersionService.deleteAppVersionEventHandler(appId, versionId, eventId);
            get().actions.setIsSaving(false);
            if (response?.affected === 1) {
              updatedEvents.splice(
                updatedEvents.findIndex((e) => e.id === eventId),
                1
              );

              set(() => ({ events: updatedEvents }));
            }
          },
          autoUpdateEventStore: async (versionId) => {
            const appId = get().appId;
            const response = await appVersionService.findAllEventsWithSourceId(appId, versionId);

            set(() => ({ events: response }));
          },
          setIsSaving: (isSaving) => set(() => ({ isSaving })),
          setAppId: (appId) => set(() => ({ appId })),
          setAppPreviewLink: (appVersionPreviewLink) => set(() => ({ appVersionPreviewLink })),
        },
      }),
      { name: 'App Data Store' }
    )
  );
}

export const useAppDataStore = (callback, shallow) => {
  const moduleName = useContext(ModuleContext);

  if (!moduleName) throw Error('module context not available');

  const _useAppDataStore = useSuperStore((state) => state.modules[moduleName].useAppDataStore);

  return _useAppDataStore(callback, shallow);
};

export const useEditingVersion = () => useAppDataStore((state) => state.editingVersion, shallow);
export const useIsSaving = () => useAppDataStore((state) => state.isSaving, shallow);
export const useUpdateEditingVersion = () => useAppDataStore((state) => state.actions, shallow);
export const useCurrentUser = () => useAppDataStore((state) => state.currentUser, shallow);
export const useAppInfo = () => useAppDataStore((state) => state);
export const useAppDataActions = () => useAppDataStore((state) => state.actions, shallow);
