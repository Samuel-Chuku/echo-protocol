import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import { config } from './config.js';

export async function startServer(): Promise<void> {
  const app = express();
  const apollo = new ApolloServer({ typeDefs, resolvers });
  await apollo.start();

  app.use('/graphql', cors(), express.json(), expressMiddleware(apollo));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  await new Promise<void>((resolve) => app.listen(config.port, resolve));
  console.log(`[server] GraphQL ready at http://localhost:${config.port}/graphql`);
}
