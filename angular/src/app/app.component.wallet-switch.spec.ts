import { AppComponent } from './app.component';

describe('AppComponent wallet switch', () => {
  function createComponent(overrides?: { hasAction?: boolean }) {
    const router = {
      navigate: jasmine.createSpy('navigate').and.resolveTo(true),
    } as any;

    const walletManager = {
      setActiveWallet: jasmine.createSpy('setActiveWallet').and.resolveTo(true),
      setActiveAccount: jasmine.createSpy('setActiveAccount').and.resolveTo(true),
      activeWallet: {
        id: 'wallet-2',
        accounts: [
          { identifier: 'acc-1', type: 'coin', networkType: 'BTC' },
          { identifier: 'acc-identity', type: 'identity', networkType: 'NOSTR' },
        ],
      },
    } as any;

    const uiState = {
      action: overrides?.hasAction ? { action: 'nostr.signevent' } : undefined,
      params: null,
    } as any;

    const component = new AppComponent(
      {} as any,
      {} as any,
      uiState,
      router,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      walletManager,
      {} as any,
      {} as any,
      {} as any,
      { instanceName: 'UnitTest', production: false } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { body: { classList: { add: () => { }, remove: () => { }, contains: () => false } } } as any
    );

    return { component, router, walletManager };
  }

  it('keeps action dialog route when switching wallet during active request', async () => {
    const { component, router, walletManager } = createComponent({ hasAction: true });

    await component.onWalletSelected('wallet-2');

    expect(walletManager.setActiveWallet).toHaveBeenCalledWith('wallet-2');
    expect(walletManager.setActiveAccount).toHaveBeenCalledWith('acc-identity');
    expect(router.navigate).toHaveBeenCalledWith(['action', 'nostr.signevent']);
    expect(router.navigate).not.toHaveBeenCalledWith(['/dashboard', 'wallet-2']);
  });

  it('navigates to dashboard when no action request is active', async () => {
    const { component, router, walletManager } = createComponent({ hasAction: false });

    await component.onWalletSelected('wallet-2');

    expect(walletManager.setActiveWallet).toHaveBeenCalledWith('wallet-2');
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard', 'wallet-2']);
  });
});
