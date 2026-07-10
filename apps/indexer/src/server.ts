import express, { type Request } from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import { config } from './config.js';
import { mountAuthRoutes, bearer } from './auth/routes.js';
import { resolveSession } from './auth/session.js';

/** GraphQL request context — carries the SIWE-proven address (or null) resolved from the bearer token. */
export interface GqlContext {
  address: string | null;
}

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

export async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1); // behind Caddy — trust the first X-Forwarded-For hop for client IP
  const apollo = new ApolloServer<GqlContext>({ typeDefs, resolvers });
  await apollo.start();

  // REST auth surface (SIWE nonce/verify/session/logout). The browser calls these cross-origin
  // (web origin → api.), so CORS must be applied here just like on /graphql.
  app.use(cors());
  app.use(express.json());
  mountAuthRoutes(app);

  app.use(
    '/graphql',
    cors(),
    expressMiddleware(apollo, {
      // Resolve the caller's proven address once per request; resolvers read ctx.address instead of
      // trusting a client-claimed `author`/`viewer` argument.
      context: async ({ req }): Promise<GqlContext> => {
        const session = await resolveSession(bearer(req), clientIp(req));
        return { address: session?.address ?? null };
      },
    }),
  );
  app.get('/health', (_req, res) => res.json({ ok: true }));

  await new Promise<void>((resolve) => app.listen(config.port, resolve));
  console.log(`[server] GraphQL ready at http://localhost:${config.port}/graphql`);
}
