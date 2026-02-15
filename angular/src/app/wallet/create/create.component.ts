import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { AbstractControl, AsyncValidatorFn, UntypedFormBuilder, FormControl, UntypedFormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { UIState, FeatureService, WalletManager, CommunicationService, CryptoService, EnvironmentService, CredentialService, WebAuthnService } from '../../services';
import { User, Wallet } from '../../../shared/interfaces';
import { copyToClipboard } from '../../shared/utilities';
import { map, Observable } from 'rxjs';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { nip19 } from 'nostr-tools';
import * as secp from '@noble/secp256k1';
import { Account } from '../../../shared/interfaces';
const { v4: uuidv4 } = require('uuid');

@Component({
  selector: 'app-wallet-create',
  templateUrl: './create.component.html',
  styleUrls: ['../wallet.component.css'],
})
export class WalletCreateComponent implements OnInit {
  mnemonic = '';
  firstFormGroup!: UntypedFormGroup;
  secondFormGroup!: UntypedFormGroup;
  step = 0;
  recover = false;
  mnemonicInputDisabled = true;
  password = '';
  password2 = '';
  showInstallDialog = true;
  wordlists: any;
  wordlist: string;
  optionsOpen = false;
  extensionWords = '';
  importMode = false;

  get passwordValidated(): boolean {
    return this.password === this.password2 && this.secondFormGroup.valid;
  }

  constructor(
    private fb: UntypedFormBuilder,
    public feature: FeatureService,
    public uiState: UIState,
    private crypto: CryptoService,
    public walletManager: WalletManager,
    private router: Router,
    private location: Location,
    private communication: CommunicationService,
    public env: EnvironmentService,
    private credentialService: CredentialService,
    private webAuthnService: WebAuthnService,
    private cd: ChangeDetectorRef,
    public translate: TranslateService,
  ) {

    this.firstFormGroup = this.fb.group({
      extensionWordsCtrl: [''],
    });

    this.secondFormGroup = this.fb.group({
      passwordCtrl: ['', Validators.required],
      password2Ctrl: ['', Validators.required],
      biometricsCtrl: [true],
    });
  }

  async ngOnInit() {
    this.uiState.title = await this.translate.get('Wallet.CreateWallet').toPromise();

    this.wordlist = this.crypto.listname;
    this.wordlists = this.crypto.languages();

    globalThis.addEventListener('DOMContentLoaded', () => {
      let displayMode = 'browser tab';

      if (globalThis.matchMedia('(display-mode: standalone)').matches) {
        displayMode = 'standalone';
      }

      // Log launch display mode to analytics
      console.log('DISPLAY_MODE_LAUNCH:', displayMode);
    });
  }

  generate() {
    // this.mnemonic = this.crypto.generateMnemonic();
    this.mnemonic = this.crypto.generateMnemonic();
  }

  copy() {
    copyToClipboard(this.mnemonic);
  }

  toggleOptions() {
    this.optionsOpen = !this.optionsOpen;
  }

  create() {
    this.next(1);
    this.recover = false;
    this.importMode = false;
    this.generate();

    this.firstFormGroup = this.fb.group({
      // firstCtrl: ['', Validators.required]
      extensionWordsCtrl: [''],
    });
  }

  onLanguageChanged(event: any) {
    this.crypto.setWordList(this.wordlist);

    if (!this.recover) {
      this.mnemonic = this.crypto.generateMnemonic(this.wordlist);
    } else {
      this.firstFormGroup.controls['firstCtrl'].updateValueAndValidity();
    }
  }

  restore() {
    this.step = 1;
    this.recover = true;
    this.importMode = false;
    this.firstFormGroup = this.fb.group({
      extensionWordsCtrl: [''],
      firstCtrl: [null, [Validators.required], [WalletCreateComponent.validateMnemonic(this.crypto)]],
    });
  }

  importKeyOnly() {
    this.step = 1;
    this.recover = false;
    this.importMode = true;
    this.firstFormGroup = this.fb.group({
      extensionWordsCtrl: [''],
      privateKeyCtrl: [null, [Validators.required]],
      importAccountNameCtrl: [this.translate.instant('Wallet.DefaultImportedAccountName')],
    });
  }

  cancel() {
    this.location.back();
  }

  static validateMnemonic(crypto: CryptoService): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors> => {
      return crypto.validateMnemonic(control.value).pipe(map((result: boolean) => (result ? null : { invalidmnemonic: true })));
    };
  }

  next(step: number) {
    this.step = step;
  }

  async save() {
    const mnemonicToEncrypt = this.importMode ? '' : this.mnemonic;
    let recoveryPhraseCipher = await this.crypto.encryptData(mnemonicToEncrypt, this.password);
    let extensionWordsCipher = undefined;

    if (this.extensionWords != null && this.extensionWords != '') {
      extensionWordsCipher = await this.crypto.encryptData(this.extensionWords, this.password);
    }

    const id = uuidv4();

    if (!recoveryPhraseCipher) {
      console.error('Fatal error, unable to encrypt secret recovery phrase!');
      alert('Fatal error, unable to encrypt secret recovery phrase!');
      return;
    } else {
      // Make the name 'Vault' for first vault, append count on other vaults.
      let walletName = this.walletManager.count() == 0 ? 'My Vault' : 'Vault ' + (this.walletManager.count() + 1);
      let biometrics = this.secondFormGroup.controls['biometricsCtrl'].value;

      var wallet: Wallet = {
        biometrics: biometrics,
        restored: this.recover,
        keyOnly: this.importMode,
        id: id,
        name: walletName,
        mnemonic: recoveryPhraseCipher,
        extensionWords: extensionWordsCipher,
        accounts: [],
      };

      await this.walletManager.addWallet(wallet);

      const unlocked = await this.walletManager.unlockWallet(wallet.id, this.password);

      if (!unlocked) {
        throw new Error('Unable to unlock newly created vault.');
      }

      if (this.importMode) {
        let importedPrivateKey = this.firstFormGroup.controls['privateKeyCtrl']?.value?.trim();
        const importedAccountName = this.firstFormGroup.controls['importAccountNameCtrl']?.value?.trim() || this.translate.instant('Wallet.DefaultImportedAccountName');

        if (importedPrivateKey.startsWith('nsec')) {
          const decoded = nip19.decode(importedPrivateKey);
          importedPrivateKey = secp.utils.bytesToHex(decoded.data as Uint8Array);
        }

        const account: Account = {
          prv: importedPrivateKey,
          identifier: uuidv4(),
          type: 'identity',
          mode: 'normal',
          singleAddress: true,
          networkType: 'NOSTR',
          name: importedAccountName,
          index: -1,
          network: 1237,
          purpose: 44,
          purposeAddress: 340,
          icon: 'account_circle',
          color: undefined,
        };

        await this.walletManager.addAccount(account, wallet, false);
      } else {
        await this.walletManager.ensureNostrIdentityAccount(wallet);
      }

      // Save the newly added wallet.
      await this.walletManager.save();
    }

    this.next(3);

    // After saving and showing final step, we'll request biometrics access:
    // this.registerCredential(wallet);
  }
}
