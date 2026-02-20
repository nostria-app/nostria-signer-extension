import { ActionMessage, ActionUrlParameters, Permission } from '../../angular/src/shared/interfaces';
import { BackgroundManager, ProcessResult } from '../../angular/src/shared/background-manager';
import { SharedManager } from '../../angular/src/shared/shared-manager';
import { RunState } from '../../angular/src/shared/task-runner';
import { WalletStore } from '../../angular/src/shared/store/wallet-store';
import { PermissionServiceShared } from '../../angular/src/shared/permission.service';
import * as browser from 'webextension-polyfill';
import { ActionState, DomainVerification, Handlers } from '../../angular/src/shared';
import { Mutex } from 'async-mutex';
import { StorageService } from '../../angular/src/shared/storage.service';
import { RuntimeService } from '../../angular/src/shared/runtime.service';
import { NetworkLoader } from '../../angular/src/shared/network-loader';
import { MessageService } from '../../angular/src/shared';
import { EventBus } from '../../angular/src/shared/event-bus';

import { Database } from '../../angular/src/shared/store/storage';

// let state: ActionState;
let prompt: any | null;
let promptMutex = new Mutex();
let releaseMutex = () => { };
let permissionService = new PermissionServiceShared();
let watchManager: BackgroundManager | null;
let networkManager: BackgroundManager;
let indexing = false;
let customActionResponse = undefined;

let networkLoader = new NetworkLoader();
let runtimeService = new RuntimeService();
let messageService = new MessageService(runtimeService, new EventBus());

let shared = new SharedManager(new StorageService(runtimeService), new WalletStore(), networkLoader, messageService);
const networkUpdateInterval = 45000;
let walletStore: WalletStore;
const EXTENSION_ID = 'nostria';

// Request queue system - handles multiple signing requests with a single popup
interface QueuedRequest {
  state: ActionState;
  resolve: (permission: Permission | null) => void;
  reject: (error: any) => void;
  duplicates?: {
    resolve: (permission: Permission | null) => void;
    reject: (error: any) => void;
  }[];
}
let requestQueue: QueuedRequest[] = [];
let isProcessingQueue = false;

// Side panel connection tracking.
// When the side panel is open, it connects via a named port ('sidepanel').
// We track this port so we can send signing requests directly to the side panel
// instead of opening a new popup window.
let sidePanelPort: chrome.runtime.Port | null = null;

// Whether the current prompt is being served via the side panel (true) or a popup window (false).
let promptViaSidePanel = false;

function getRequestSignature(state: ActionState): string {
  const method = state.message.request.method;
  const app = state.message.app ?? '';
  const params = state.message.request.params ?? [];
  return `${app}|${method}|${JSON.stringify(params)}`;
}

function resolveQueuedRequest(request: QueuedRequest, permission: Permission | null) {
  request.resolve(permission);

  if (request.duplicates?.length) {
    for (const duplicate of request.duplicates) {
      duplicate.resolve(permission);
    }
  }
}

function rejectQueuedRequest(request: QueuedRequest, error: any) {
  request.reject(error);

  if (request.duplicates?.length) {
    for (const duplicate of request.duplicates) {
      duplicate.reject(error);
    }
  }
}

// Message handler for extension messaging
// Use native chrome API with sendResponse for reliable async responses in MV3
chrome.runtime.onMessage.addListener((msg: ActionMessage, sender, sendResponse) => {
  // Handle async message processing
  (async () => {
    try {
      // Open the database.
      await Database.Instance.open();

      // We verify in both content.ts and here, simply because hostile website can always load the provider.ts if
      // they reference it directly manually.
      let verify = DomainVerification.verify(msg.app);

      if (verify == false) {
        console.warn('Request is not allowed on this domain.');
        sendResponse({ error: { message: 'Request is not allowed on this domain.' } });
        return;
      }

      msg.verify = verify;

      // console.log('Receive message in background:', msg);

      // When messages are coming from popups, the prompt will be set.
      if (msg.prompt) {
        if (msg.promptResponse) {
          customActionResponse = msg.promptResponse;
        }

        await handlePromptMessage(msg, sender);
        sendResponse({ success: true });
        return;
      } else if (msg.source == 'provider') {
        const result = await handleContentScriptMessage(msg);

        // If the side panel is connected, route the notification there instead
        // of showing it on the website.
        if (result && result.notification && sidePanelPort) {
          try {
            sidePanelPort.postMessage({
              type: 'notification',
              data: { text: result.notification },
            });
          } catch (e) {
            // Port may have disconnected; ignore.
          }
          delete result.notification;
        }

        sendResponse(result);
        return;
      } else if (msg.source == 'tabs') {
        // Handle messages coming from the UI.
        if (msg.type === 'keep-alive') {
          // console.debug('Received keep-alive message.');
          sendResponse({ success: true });
          return;
        } else if (msg.type === 'index') {
          await executeIndexer();
          sendResponse({ success: true });
          return;
        } else if (msg.type === 'watch') {
          await runWatcher();
          sendResponse({ success: true });
          return;
        } else if (msg.type === 'network') {
          // When we get the 'network' message, we'll scan network and then run index.
          await updateNetworkStatus();
          await executeIndexer();
          sendResponse({ success: true });
          return;
        } else if (msg.type === 'activated') {
          // console.log('THE UI WAS ACTIVATED!!');
          // When UI is triggered, we'll also trigger network watcher.
          await networkStatusWatcher();
          sendResponse({ success: true });
          return;
        } else if (msg.type === 'broadcast') {
          // Grab the content returned in this message and use as custom action response.
          customActionResponse = msg.response.response;

          // If there is an active prompt, it means we should resolve it with the broadcast result:
          if (prompt) {
            prompt?.resolve?.();
            prompt = null;
            releaseMutex();
          }

          sendResponse({ success: true });
          return;
        }
        sendResponse({ success: true });
        return;
      } else {
        // console.log('Unhandled message:', msg);
        sendResponse({ error: { message: 'Unhandled message type' } });
        return;
      }
    } catch (error: any) {
      console.error('Error in message handler:', error);
      sendResponse({ error: { message: error.message } });
    }
  })();
  
  // Return true to indicate we will send response asynchronously
  return true;
});

chrome.runtime.onMessageExternal.addListener((msg: ActionMessage, sender, sendResponse): boolean => {
  (async () => {
    try {
      // We verify in both content.ts and here, simply because hostile website can always load the provider.ts if
      // they reference it directly manually.
      let verify = DomainVerification.verify(msg.app);

      if (verify == false) {
        console.warn('Request is not allowed on this domain.');
        sendResponse({ error: { message: 'Request not allowed' } });
        return;
      }

      console.log('BACKGROUND:EXTERNAL:MSG:', msg);
      let extensionId = new URL(sender.url!).host;
      msg.app = extensionId;
      const result = await handleContentScriptMessage(msg);
      sendResponse(result);
    } catch (error: any) {
      sendResponse({ error: { message: error.message } });
    }
  })();
  
  return true;
});

async function handleContentScriptMessage(message: ActionMessage) {
  // We only allow messages of type 'request' here.
  if (message.type !== 'request') {
    return { error: { message: 'Invalid message type' } };
  }

  const method = message.request.method;
  
  const params = message.request.params ? message.request.params[0] : undefined;

  // Create a new handler instance.
  let id = Math.random().toString().slice(4);

  // Ensure that we have a BackgroundManager available for the action handler.
  if (networkManager == null) {
    networkManager = new BackgroundManager(shared);
  }

  const state = new ActionState();
  state.id = message.id;
  state.id2 = id;

  try {
    // This will throw error if the action is not supported.
    state.handler = Handlers.getAction(method, networkManager);
  } catch (err: any) {
    return { error: { message: `Unsupported method: ${method}` } };
  }
  
  state.message = message;

  // Use the handler to prepare the content to be displayed for signing.
  const prepare = await state.handler.prepare(state);
  state.content = prepare.content;

  let permission: Permission | unknown | null = null;
  // console.log('Permission:', permission);

  if (prepare.consent) {
    // Reload the permissions each time.
    await permissionService.refresh();

    if (params?.key) {
      permission = permissionService.findPermissionByKey(message.app!, method, params.key);
    } else {
      // Get all existing permissions that exists for this app and method:
      let permissions = permissionService.findPermissions(message.app!, method) as any[];

      // If there are no specific key specified in the signing request, just grab the first permission that is approved for this
      // website and use that. Normally there will only be a single one if the web app does not request specific key.
      // This key is selected based upon app and method.
      if (permissions?.length > 0) {
        permission = permissions[0];
      }
    }

    // Check if user have already approved this kind of access on this domain/host.
    if (!permission) {
      try {
        // Keep a copy of the prompt message, we need it to finalize if user clicks "X" to close window.
        permission = await promptPermission(state);
        // authorized, proceed
      } catch (err) {

        // When the user clicks X during a payment request, the user might still have completed the process, and
        // we should return a successful response here. For other actions, clicking X means "Cancel"/"Deny".

        // not authorized, stop here
        return {
          error: { message: `Insufficient permissions, required "${method}".` },
        };
      }
    } else {
      // TODO: This logic can be put into the query into permission set, because permissions
      // must be stored with more keys than just "action", it must contain wallet/account and potentially keyId.

      // If there exists an permission, verify that the permission applies to the specified (or active) wallet and account.
      // If the caller has supplied walletId and accountId, use that.
      if (message.walletId && message.accountId) {
      } else {
        // If nothing is supplied, verify against the current active wallet/account.
      }
    }
  }

  if (customActionResponse) {
    // Clone and clean.
    const customReturn = JSON.stringify(customActionResponse);
    customActionResponse = undefined;
    return JSON.parse(customReturn);
  }

  try {
    const p = <Permission>permission;

    if (p) {
      const isKeyUnlocked = await networkManager.isKeyUnlocked(p.walletId);

      // The key is empty if the wallet is locked. Force user to unlock before we continue.
      if (p && prepare.consent && !isKeyUnlocked) {
        // Clone existing state for use with only unlocking.
        const unlockState = JSON.parse(JSON.stringify(state)) as ActionState;

        unlockState.message.request.method = 'wallet.unlock';
        unlockState.message.request.params = [{ walletId: p.walletId }];

        await promptUnlock(unlockState);
      }
    }

    // User have given permission to execute.
    const result = await state.handler.execute(state, p);

    // Increase the execution counter
    const executions = await permissionService.increaseExecution(<Permission>permission);

    // If this execution required consent then display a notification.
    if (prepare.consent) {
      const actionLabel = (<Permission>permission).action.replace(/^nostr\./, '');
      result.notification = `Nostria Signer: ${actionLabel} (${executions})`;
    }

    return result;
  } catch (error: any) {
    return { error: { message: error.message, stack: error.stack } };
  }
}

async function promptUnlock(state: ActionState) {
  try {
    // Keep a copy of the prompt message, we need it to finalize if user clicks "X" to close window.
    // state.promptPermission = await promptPermission({ app: message.app, id: message.id, method: method, params: message.args.params });
    await promptPermission(state);
    // authorized, proceed
  } catch (err) {
    console.error('Permission not accepted: ', err);
  }
}

async function handlePromptMessage(message: ActionMessage, sender: any) {
  // Create an permission instance from the message received from prompt dialog:
  const permission = permissionService.createPermission(message);

  switch (message.permission) {
    case 'forever':
    case 'connect':
    case 'expirable':
      await permissionService.persistPermission(permission);
      prompt?.resolve?.(permission);
      // After granting a reusable permission, process remaining queued requests that might benefit
      processQueuedRequestsWithPermission(permission);
      break;
    case 'once':
      prompt?.resolve?.(permission);
      break;
    case 'no':
      prompt?.reject?.();
      break;
  }

  prompt = null;
  releaseMutex();

  // Only close the window if the prompt was served via a popup window (not the side panel).
  // sender.tab may be undefined for extension pages like the side panel.
  if (!promptViaSidePanel && sender?.tab?.windowId != null) {
    // Remove the popup window that was opened:
    browser.windows.remove(sender.tab.windowId);
  }

  promptViaSidePanel = false;
  
  // Continue processing the queue after this prompt is handled
  processNextInQueue();
}

// Process queued requests that can now be auto-approved with the newly granted permission
async function processQueuedRequestsWithPermission(grantedPermission: Permission) {
  if (!grantedPermission || grantedPermission.type === 'once') {
    return; // Only reusable permissions can auto-approve other requests
  }

  // Find and resolve queued requests that match the granted permission
  const matchingRequests: QueuedRequest[] = [];
  const remainingRequests: QueuedRequest[] = [];
  const activeRequest = isProcessingQueue ? requestQueue[0] : null;

  for (const queuedRequest of requestQueue) {
    // Never mutate or auto-resolve the request currently being actively processed.
    // It is resolved by processNextInQueue after showPermissionPopup returns.
    if (activeRequest && queuedRequest === activeRequest) {
      remainingRequests.push(queuedRequest);
      continue;
    }

    const method = queuedRequest.state.message.request.method;
    const app = queuedRequest.state.message.app;
    const params = queuedRequest.state.message.request.params ? queuedRequest.state.message.request.params[0] : undefined;

    // Check if this queued request matches the granted permission
    const isMatch = app === grantedPermission.app && method === grantedPermission.action;

    if (isMatch) {
      // If the permission is key-specific, verify the key matches
      if (params?.key && grantedPermission.key && params.key !== grantedPermission.key) {
        remainingRequests.push(queuedRequest);
      } else {
        matchingRequests.push(queuedRequest);
      }
    } else {
      remainingRequests.push(queuedRequest);
    }
  }

  // Update the queue to only contain non-matching requests
  requestQueue = remainingRequests;

  // Resolve all matching requests with the granted permission
  for (const match of matchingRequests) {
    resolveQueuedRequest(match, grantedPermission);
  }
}

function findExistingPermissionForState(state: ActionState): Permission | null {
  const method = state.message.request.method;
  const app = state.message.app;
  const params = state.message.request.params ? state.message.request.params[0] : undefined;

  if (!app) {
    return null;
  }

  if (params?.key) {
    return permissionService.findPermissionByKey(app, method, params.key);
  }

  const permissions = permissionService.findPermissions(app, method) as any[];
  if (permissions?.length > 0) {
    return permissions[0];
  }

  return null;
}

// Add a request to the queue and start processing if not already doing so
function queuePermissionRequest(state: ActionState): Promise<Permission | null> {
  return new Promise((resolve, reject) => {
    const signature = getRequestSignature(state);
    const existingRequest = requestQueue.find((request) => getRequestSignature(request.state) === signature);

    if (existingRequest) {
      existingRequest.duplicates ??= [];
      existingRequest.duplicates.push({ resolve, reject });
      return;
    }

    requestQueue.push({ state, resolve, reject });
    
    // Start processing if not already
    if (!isProcessingQueue) {
      processNextInQueue();
    }
  });
}

// Process the next request in the queue
async function processNextInQueue() {
  if (isProcessingQueue || requestQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  // Before showing a popup, re-check if permission was already granted
  // (another popup may have granted it while this request was waiting)
  await permissionService.refresh();

  const nextRequest = requestQueue[0];
  if (!nextRequest) {
    isProcessingQueue = false;
    return;
  }

  // Re-check for existing permission
  const existingPermission = findExistingPermissionForState(nextRequest.state);

  if (existingPermission) {
    // Permission already exists, resolve without popup
    requestQueue.shift(); // Remove from queue
    resolveQueuedRequest(nextRequest, existingPermission);
    isProcessingQueue = false;
    // Process next item in queue
    processNextInQueue();
    return;
  }

  // No permission found, show popup for this request
  try {
    const permission = await showPermissionPopup(nextRequest.state);
    requestQueue.shift(); // Remove from queue after popup closes
    resolveQueuedRequest(nextRequest, permission);
  } catch (err) {
    requestQueue.shift(); // Remove from queue
    rejectQueuedRequest(nextRequest, err);
  }

  isProcessingQueue = false;
  // Continue draining the queue. handlePromptMessage may run before this function
  // clears isProcessingQueue, so relying only on that callback can leave items stuck.
  processNextInQueue();
}

// Queue-based prompt: adds request to queue instead of directly showing popup
async function promptPermission(state: ActionState): Promise<Permission | null> {
  await permissionService.refresh();
  const existingPermission = findExistingPermissionForState(state);

  if (existingPermission) {
    return existingPermission;
  }

  return queuePermissionRequest(state);
}

// Actually show the popup window for a permission request.
// If the side panel is open, send the action there instead of opening a new popup.
async function showPermissionPopup(state: ActionState): Promise<Permission> {
  await permissionService.refresh();
  const existingPermission = findExistingPermissionForState(state);

  if (existingPermission) {
    return existingPermission;
  }

  releaseMutex = await promptMutex.acquire();

  var parameters: ActionUrlParameters | any = {
    id: state.message.id,
    app: state.message.app!,
    action: state.message.request.method,
    content: JSON.stringify(state.content), // Content prepared by the handler to be displayed for user.
    params: JSON.stringify(state.message.request.params), // Params is used to display structured information for signing.
    verify: state.message.verify,
    queueLength: requestQueue.length, // Pass queue length so UI can show "X more requests pending"
  };

  return new Promise((resolve, reject) => {
    // Set the global prompt object:
    prompt = { resolve, reject };

    // If the side panel is connected, send the action request there instead of opening a popup window.
    if (sidePanelPort) {
      try {
        promptViaSidePanel = true;
        sidePanelPort.postMessage({
          type: 'action-request',
          data: parameters,
        });
        return;
      } catch (e) {
        // Side panel port may have been disconnected; fall through to popup.
        sidePanelPort = null;
        promptViaSidePanel = false;
      }
    }

    promptViaSidePanel = false;
    let qs = new URLSearchParams(parameters);

    browser.windows.create({
      url: `${browser.runtime.getURL('index.html')}?${qs.toString()}`,
      type: 'popup',
      width: 628,
      height: 800,
    });
  });
}

browser.windows.onRemoved.addListener(function (windowId) {
  if (prompt) {
    prompt?.reject?.();
    prompt = null;
    releaseMutex();
    // Continue processing the queue even if user closed the popup
    isProcessingQueue = false;
    processNextInQueue();
  }
});

// Run when the browser has been fully exited and opened again.
browser.runtime.onStartup.addListener(async () => {
  console.log('Extension: onStartup');
});

// Service worker suspend event - save any important state
// Note: onSuspend is Chrome-specific, use chrome namespace directly
if (typeof chrome !== 'undefined' && chrome.runtime?.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    console.log('Extension: onSuspend.');
  });
}

browser.runtime.onConnect.addListener((port) => {
  console.log('onConnect:', port);

  if (port.name === 'sidepanel') {
    sidePanelPort = port as unknown as chrome.runtime.Port;
    port.onDisconnect.addListener(() => {
      sidePanelPort = null;

      // If the side panel is closed while a prompt is active, reject the prompt
      // (same behavior as closing a popup window).
      if (prompt && promptViaSidePanel) {
        prompt?.reject?.();
        prompt = null;
        promptViaSidePanel = false;
        releaseMutex();
        isProcessingQueue = false;
        processNextInQueue();
      }
    });
  }
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  // Open the database.
  await Database.Instance.open();

  // console.debug('onInstalled', reason);

  // Periodic alarm that will check if wallet should be locked.
  const periodicAlarm = await browser.alarms.get('periodic');
  if (!periodicAlarm) {
    await browser.alarms.create('periodic', { periodInMinutes: 1 });
  }

  // The index alarm is used to perform background scanning of the
  // whole address space of all wallets. This will check used addresses
  // that might have received transactions after used the first time.
  // TODO: Log the last UI activation date and increase the period by the time since
  // UI was last activated. If it's 1 hour since last time, set the periodInMinutes to 60.
  // And if user has not used the extension UI in 24 hours, then set interval to 24 hours.
  const indexAlarm = await browser.alarms.get('index');
  if (!indexAlarm) {
    await browser.alarms.create('index', { periodInMinutes: 10 });
  }

  if (reason === 'install') {
    // Open a new tab for initial setup, before we wait for network status watcher.
    await browser.tabs.create({ url: 'index.html' });
    await networkStatusWatcher();
    await executeIndexer();
  } else if (reason === 'update') {
    // await browser.tabs.create({ url: 'index.html' });
    // Run a full indexing when the extension has been updated/reloaded.
    await networkStatusWatcher();
    await executeIndexer();
  }
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  // Open the database.
  await Database.Instance.open();

  if (alarm.name === 'periodic') {
    await shared.checkLockTimeout();
  } else if (alarm.name === 'index') {
    await executeIndexer();
  }
});

let networkWatcherRef;

const updateNetworkStatus = async () => {
  // We don't have Angular environment information in the service worker,
  // so we'll default to Nostria default accounts.
  await networkManager.updateNetworkStatus('nostria');

  // Note: Service workers don't have access to location.host, use runtime.id instead
  try {
    await browser.runtime.sendMessage({
      type: 'network-updated',
      data: { source: 'network-status-watcher' },
      ext: EXTENSION_ID,
      source: 'background',
      target: 'tabs',
      host: browser.runtime.id,
    });
  } catch (e) {
    // Ignore errors when no listeners are registered
  }

  // Whenever the network status has updated, also trigger indexer.
  // 2022-02-12: We don't need to force indexer it, it just adds too many extra calls to indexing.
  // await executeIndexer();
};

const networkStatusWatcher = async () => {
  // const manifest = chrome.runtime.getManifest();

  if (networkWatcherRef) {
    globalThis.clearTimeout(networkWatcherRef);
    networkWatcherRef = null;
  }

  if (networkManager == null) {
    networkManager = new BackgroundManager(shared);
  }

  var interval = async () => {
    await updateNetworkStatus();

    // Continue running the watcher if it has not been cancelled.
    networkWatcherRef = globalThis.setTimeout(interval, networkUpdateInterval);
  };

  // First interval we'll wait for complete run.
  await interval();

  // networkWatcherRef = globalThis.setTimeout(async () => {
  //     await interval();
  // }, 0);
};

const executeIndexer = async () => {
  // If we are already indexing, simply ignore this request.
  if (indexing) {
    return;
  }

  indexing = true;
  await runIndexer();
  indexing = false;

  // When the indexer has finished, run watcher automatically.
  await runWatcher();
};

const runIndexer = async () => {
  // Stop and ensure watcher doesn't start up while indexer is running.
  if (watchManager) {
    watchManager.onStopped = () => { };
    watchManager.stop();
    watchManager = null;
  }

  // Whenever indexer is executed, we'll create a new manager.
  let manager: any = new BackgroundManager(shared);
  manager.onUpdates = async (status: ProcessResult) => {
    try {
      if (status.changes) {
        await browser.runtime.sendMessage({
          type: 'indexed',
          data: { source: 'indexer-on-schedule' },
          ext: EXTENSION_ID,
          source: 'background',
          target: 'tabs',
          host: browser.runtime.id,
        });
      } else {
        await browser.runtime.sendMessage({
          type: 'updated',
          data: { source: 'indexer-on-schedule' },
          ext: EXTENSION_ID,
          source: 'background',
          target: 'tabs',
          host: browser.runtime.id,
        });
      }
    } catch (e) {
      // Ignore errors when no listeners are registered
    }
  };

  await manager.runIndexer();

  // Reset the manager after full indexer run.
  manager = null;
};

const runWatcher = async () => {
  // If we are indexing, simply ignore all calls to runWatcher.
  if (indexing) {
    return;
  }

  // If there are multiple requests incoming to stop the watcher at the same time
  // they will all simply mark the watch manager to stop processing, which will
  // automatically start a new instance when finished.
  if (watchManager != null) {
    // First stop the existing watcher process.
    watchManager.stop();
    // console.log('Calling to stop watch manager...');
  } else {
    watchManager = new BackgroundManager(shared);

    // Whenever the manager has successfully stopped, restart the watcher process.
    watchManager.onStopped = () => {
      // console.log('Watch Manager actually stopped, re-running!!');
      watchManager = null;
      runWatcher();
    };

    watchManager.onUpdates = async (status: ProcessResult) => {
      try {
        if (status.changes) {
          await browser.runtime.sendMessage({
            type: 'indexed',
            data: { source: 'watcher' },
            ext: EXTENSION_ID,
            source: 'background',
            target: 'tabs',
            host: browser.runtime.id,
          });
        } else {
          await browser.runtime.sendMessage({
            type: 'updated',
            data: { source: 'watcher' },
            ext: EXTENSION_ID,
            source: 'background',
            target: 'tabs',
            host: browser.runtime.id,
          });
        }
      } catch (e) {
        // Ignore errors when no listeners are registered
      }
    };

    let runState: RunState = {};

    await watchManager.runWatcher(runState);
  }
};

// // For future usage when Point-of-Sale window is added, opening the window should just focus that tab.
// await chrome.tabs.update(tabs[0].id, { active: true });

// // Setting the badge
// await chrome.action.setBadgeText({ text: '44' });
// await chrome.action.setBadgeBackgroundColor({ color: 'red' });
