import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { EnvironmentService, SettingsService } from '.';
import { ActionUrlParameters, Message } from '../../shared/interfaces';
import { EventBus } from '../../shared/event-bus';
import { LoggerService } from './logger.service';
import { RuntimeService } from '../../shared/runtime.service';
import { StateService } from './state.service';
import { WalletManager } from './';
import * as browser from 'webextension-polyfill';
import { UIState } from './ui-state.service';
import { SecureStateService } from './secure-state.service';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CommunicationService {
  /** Port connection to the background service worker (used by the side panel). */
  private sidePanelPort: browser.Runtime.Port | null = null;

  /**
   * Persistent flag indicating this instance was launched as the side panel.
   * Set once during initialize() based on the initial hash, before Angular
   * routing changes the hash fragment.
   */
  private _isSidePanel = false;

  /** Emits notification text to display briefly in the side panel. */
  notification$ = new Subject<string>();

  constructor(
    private ngZone: NgZone,
    private walletManager: WalletManager,
    private state: StateService,
    private settings: SettingsService,
    private runtime: RuntimeService,
    private events: EventBus,
    private router: Router,
    private logger: LoggerService,
    private env: EnvironmentService,
    private uiState: UIState,
    private secure: SecureStateService
  ) {}

  /** Returns true if the current instance is running as the side panel. */
  get isSidePanel(): boolean {
    return this._isSidePanel;
  }

  initialize() {
    // Capture the side panel flag once, before Angular routing changes the hash.
    this._isSidePanel = globalThis.location.hash?.startsWith('#/side') ?? false;

    // TODO: Handle these messages internally when running outside of extension context.
    if (this.runtime.isExtension) {
      browser.runtime.onMessage.addListener((message: any, sender: browser.Runtime.MessageSender): Promise<any> | void => {
        // Skip messages this UI instance should not handle. Returning undefined
        // (instead of a Promise) tells the browser this listener will NOT send a
        // response, allowing the background service worker to respond instead.
        // Without this guard the side panel's never-resolving Promise blocks the
        // response from the background for content-script originated messages.
        if (message.source === 'provider' || message.prompt) {
          return;
        }

        return new Promise((resolve) => {
          this.ngZone.run(async () => {
            const result = await this.handleInternalMessage(message, sender);

            // Only return a response if the result is other than null. Null means we did not handle the message.
            if (result !== null) {
              resolve(result);
            }
          });
        });
      });

      browser.runtime.onMessageExternal.addListener(async (message: any, sender: browser.Runtime.MessageSender) => {
        // console.log('browser.runtime.onMessageExternal within ANGULAR!');
        return new Promise((resolve) => {
          this.ngZone.run(async () => {
            const result = await this.handleExternalMessage(message, sender);
            // this.logger.debug(`Process (external) messaged ${message.type} and returning this response: `, result);

            // Only return a response if the result is other than null. Null means we did not handle the message.
            if (result !== null) {
              resolve(result);
            }
          });
        });
      });

      // If running in the side panel, connect to the background via a named port.
      // This lets the background service worker detect the side panel is open and
      // send signing requests directly to it instead of opening popup windows.
      if (this.isSidePanel) {
        this.connectSidePanelPort();
      }
    } else {
      // 'Running in web mode, event handling is processes by FrontEnd Service.
      // this.events.subscribeAll().subscribe(async (message) => {
      //   this.ngZone.run(async () => {
      //     // Compared to the extension based messaging, we don't have response messages.
      //     // this.logger.debug(`Process message:`, message);
      //     await this.handleMessage(message.data);
      //   });
      // });
    }
  }

  /** Establish a named port connection to the background for side panel communication. */
  private connectSidePanelPort() {
    try {
      this.sidePanelPort = browser.runtime.connect({ name: 'sidepanel' });

      this.sidePanelPort.onMessage.addListener((message: any) => {
        this.ngZone.run(() => {
          if (message.type === 'action-request') {
            this.handleSidePanelActionRequest(message.data);
          } else if (message.type === 'notification') {
            this.notification$.next(message.data.text);
          }
        });
      });

      this.sidePanelPort.onDisconnect.addListener(() => {
        this.sidePanelPort = null;
        // The MV3 service worker may have gone idle and been terminated,
        // which disconnects all ports. Reconnect after a short delay so
        // the background re-registers the side panel on its next wake.
        setTimeout(() => this.connectSidePanelPort(), 500);
      });
    } catch (e) {
      this.logger.warn('Failed to connect side panel port:', e);
      // Retry after a delay in case the service worker is restarting.
      setTimeout(() => this.connectSidePanelPort(), 1000);
    }
  }

  /** Handle an action request delivered to the side panel from the background. */
  private handleSidePanelActionRequest(parameters: ActionUrlParameters) {
    let verify: boolean | undefined = undefined;

    if (parameters.verify === 'true' || (parameters as any).verify === true) {
      verify = true;
    } else if (parameters.verify === 'false' || (parameters as any).verify === false) {
      verify = false;
    }

    const hasJsonStructure = (str: any): boolean => {
      if (typeof str !== 'string') return false;
      try {
        const result = JSON.parse(str);
        const type = Object.prototype.toString.call(result);
        return type === '[object Object]' || type === '[object Array]';
      } catch (err) {
        return false;
      }
    };

    const parsedContent = hasJsonStructure(parameters.content) ? JSON.parse(parameters.content) : parameters.content;

    this.uiState.action = {
      action: parameters.action,
      id: parameters.id,
      content: parsedContent,
      params: JSON.parse(parameters.params),
      app: parameters.app,
      verify: verify,
    };

    // If the wallet is unlocked, navigate directly to the action route.
    if (this.walletManager.activeWallet && this.secure.unlocked(this.walletManager.activeWallet.id)) {
      this.router.navigate(['action', this.uiState.action.action]);
    } else {
      // Wallet is locked; navigate to home to unlock first.
      this.router.navigateByUrl('/home');
    }
  }

  handleInternalMessage(message: Message, sender: browser.Runtime.MessageSender) {
    // If the source is provider, never handle these messages as multiple open
    // instances of the extension will cause callbacks from provider to complete.
    if (message.source === 'provider') {
      return null;
    }

    // We can't do async await in this handler, because the chrome extension runtime does not support it
    // and will begin to throw channel port errors.
    // console.log('CommunicationService:handleInternalMessage:', message);
    try {
      switch (message.type) {
        case 'updated': {
          // console.log('SERVICE WORKER HAS FINISHED INDEXING, but no changes to the data, but we get updated wallet info.', message.data);
          // await this.state.update();
          this.state.refresh();
          return 'ok';
        }
        case 'indexed': {
          // console.log('SERVICE WORKER HAS FINISHED INDEXING!!! WE MUST RELOAD STORES!', message.data);
          this.state.refresh();
          return 'ok';
        }
        case 'reload': {
          // console.log('Wallet / Account might be deleted, so we must reload state.');
          this.state.reload();
          return 'ok';
        }
        case 'network-updated': {
          // console.log('Network status was updated, reload the networkstatus store!');
          this.state.reloadStore('networkstatus');
          return 'ok';
        }
        case 'store-reload': {
          console.log(`Specific store was requested to be updated: ${message.data}`);
          this.state.reloadStore(message.data);

          if (message.data === 'setting') {
            this.settings.update();
          }

          return 'ok';
        }
        case 'timeout': {
          // Timeout was reached in the background. There is already logic listening to the session storage
          // that will reload state and redirect to home (unlock) if needed, so don't do that here. It will
          // cause a race condition on loading new state if redirect is handled here.
          this.logger.info('Timeout was reached in the background service (handleInternalMessage).');

          if (this.walletManager.activeWallet) {
            this.walletManager.lockWallet(this.walletManager.activeWallet.id);
          }

          this.router.navigateByUrl('/home');
          return 'ok';
          //return null;
        }
        // default:
        //   this.logger.warn(`The message type ${message.type} is not known.`);
        //   return 'ok';
        //return null;
      }
    } catch (error: any) {
      return { error: { message: error.message, stack: error.stack } };
    }

    return null;
  }

  async handleExternalMessage(message: any, sender: browser.Runtime.MessageSender) {
    this.logger.info('CommunicationService:onMessageExternal: ', message);
    this.logger.info('CommunicationService:onMessageExternal:sender: ', sender);
  }
}
