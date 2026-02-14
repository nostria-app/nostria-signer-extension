# Nostria Signer

### Nostr signer for your Browser

The Nostria Signer does vault management, account management, identity management and signing. Built on web-technology, Nostria Signer is cross-platform and works in
different modes, such as browser extension, Progressive Web App, native mobile and desktop app and more.

Open the [Installation Guide](https://www.blockcore.net/wallet/guide) to install the signer.

![](/doc/signer-create-vault.gif)

## Features

The signer supports having multiple active vaults at the same time, and each vault can contain one or more accounts.

- [x] Multiple vaults with multiple accounts
- [x] Internationalization support with multiple languages and LTR/RTL support.
- [x] Nostr support

## Browser Support
Nostria Signer supports all Chromium based browsers - Chrome, Edge Opera, Brave etc.

Firefox is not supported. Support for Firefox is not planned.

## WARNING AND RISK

This software should be considered experimental, use at your own risk.

All the standard practices for self-custody apply: Make sure you take backup of your secret recovery phrase. We are not responsible for any mistakes or problems with the software and services. You hold your own keys, we can never restore or help you if you lose your secret recovery phrase. You can still lose valuables even though you don't lose your recovery phrase, due to bugs and issues in the software provided. Use at your own risk.

# Development

First you need to get the source code and you should include the submodules:

```
git clone --recurse-submodules https://github.com/block-core/nostria-signer.git
```

If you have already cloned and don't have the submodules, you might get an error with importing the lists.

You can do the following to initialize the submodules if you cloned without --recurse-submodules.

```
git submodule init
git submodule update
```

## Requirements

- Node.js LTS (16.x): https://nodejs.org/en/
- Angular CLI: `npm install -g @angular/cli`
- Install the suggested workspace extensions for VS Code

## Code Formatting Rules

Please use an editor that respects the .editorconfig when auto-formatting the code.

If formatting is not applied according to the rules, make sure you don't have configuration in user settings for VS Code: `%APPDATA%\Code\User\settings.json`

## Run with Hot-Reload

```sh
npm install
npm start
```

This will run Angular in watch-mode and ensure it auto-reloads.

## Install Extension

To install the extension, follow the instructions here: https://docs.microsoft.com/en-us/microsoft-edge/extensions-chromium/getting-started/extension-sideloading

Choose the `nostria-signer\dist\extension` folder when picking folder for extension to load from.

## Update Allow/Deny lists

The `lists` is a git submodule and to update to latest:

```sh
git submodule update --remote --merge
```
