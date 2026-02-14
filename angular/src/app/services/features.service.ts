
import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class FeatureService {
    private readonly features = ['wallet', 'identity', 'handler:nostr'];

    enabled(feature: string) {
        return this.features.includes(feature);
    }

    enabledGroup(featurePrefix: string) {
        // Check if any features starts with the prefix:
        return this.features.some(f => f.startsWith(featurePrefix));
    }
}
