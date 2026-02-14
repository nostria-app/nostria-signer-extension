import { Location } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { NetworkStatusEntry } from 'src/shared';
import { UIState, FeatureService } from '../../services';

@Component({
  selector: 'app-network',
  templateUrl: './network.component.html',
  styleUrls: ['./network.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class NetworkComponent implements OnDestroy, OnInit {
  networks: NetworkStatusEntry[];
  updating = false;

  constructor(public uiState: UIState, public location: Location, public feature: FeatureService, public translate: TranslateService) {
    this.uiState.showBackButton = true;
    this.uiState.goBackHome = false;
  }

  async ngOnInit() {

    this.uiState.title = await this.translate.get('Settings.NetworkStatus').toPromise();

    this.networks = [];
  }

  async load() {
    this.networks = [];
  }

  ngOnDestroy() {}

  cancel() {
    this.location.back();
  }

  async reset() {
    await this.load();
  }

  async updatedSelectedNetwork() {
    return;
  }
}
