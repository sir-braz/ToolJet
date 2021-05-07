import { RestApi } from './RestApi';
import { Mysql } from './Mysql';
import { Postgresql } from './Postgresql';
import { Stripe } from './Stripe';
import { Firestore } from './Firestore';
import { Redis } from './Redis';
import { Googlesheets } from './Googlesheets';
import { Elasticsearch } from './Elasticsearch';
import { Slack } from './Slack';
import { Mongodb } from './Mongodb';

export const allSources = {
  RestApi,
  Mysql,
  Postgresql,
  Stripe,
  Firestore,
  Redis,
  Googlesheets,
  Elasticsearch,
  Slack,
  Mongodb
};
