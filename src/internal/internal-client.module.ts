import { DynamicModule, Global, Module } from '@nestjs/common';
import { InternalClient } from './internal-client.js';

/**
 * Configuration for a single peer service client.
 */
export interface PeerConfig {
  /** Injection token used by consuming services (e.g. `'CONTENT_CLIENT'`). */
  name: string;
  /**
   * Name of the environment variable holding the peer's base URL
   * (e.g. `'API_CONTENT_URL'`). The env var must be set at runtime.
   */
  baseUrlEnv: string;
}

/**
 * InternalClientModule provides named InternalClient instances for each peer
 * service. It mirrors how `ClientsModule.register([{name, transport}])` made
 * named ClientProxy tokens available.
 *
 * Usage in an app module:
 * ```ts
 * @Module({
 *   imports: [
 *     InternalClientModule.registerPeers([
 *       { name: 'CONTENT_CLIENT', baseUrlEnv: 'API_CONTENT_URL' },
 *       { name: 'CRED_CLIENT',    baseUrlEnv: 'API_CRED_URL'    },
 *     ]),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * Then inject by name token:
 * ```ts
 * constructor(@Inject('CONTENT_CLIENT') private readonly content: InternalClient) {}
 * ```
 *
 * Phase 2 swap: replace `@Inject('CONTENT_Q') private content: ClientProxy`
 * with `@Inject('CONTENT_CLIENT') private content: InternalClient` and remove
 * `firstValueFrom` wrappers around `.send()` calls.
 */
@Global()
@Module({})
export class InternalClientModule {
  static registerPeers(peers: PeerConfig[]): DynamicModule {
    const providers = peers.map((peer) => ({
      provide: peer.name,
      useFactory: (): InternalClient => {
        const baseUrl = process.env[peer.baseUrlEnv];
        const token = process.env['INTERNAL_TOKEN'];

        if (!baseUrl) {
          throw new Error(
            `InternalClientModule: env var ${peer.baseUrlEnv} is not set for peer "${peer.name}"`,
          );
        }
        if (!token) {
          throw new Error(
            `InternalClientModule: INTERNAL_TOKEN env var is not set (required by peer "${peer.name}")`,
          );
        }

        return new InternalClient(baseUrl, token);
      },
    }));

    return {
      module: InternalClientModule,
      providers,
      exports: providers,
    };
  }
}
