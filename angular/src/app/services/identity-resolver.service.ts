import { DIDResolutionOptions, Resolver } from 'did-resolver';
import is from '@blockcore/did-resolver';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
/** Helps resolve all DID Methods that the Nostria Signer supports. */
export class IdentityResolverService {
  private resolver: Resolver;

  constructor() {
    // TODO: The Nostria Signer will be able to resolve multiple, so use the below code:
    //If you are using multiple methods you need to flatten them into one object
    // const resolver = new Resolver({
    // 	...ethrResolver,
    // 	...webResolver,
    // });

    const isResolver = is.getResolver();
    this.resolver = new Resolver(isResolver);
  }

  async resolve(didUrl: string, options: DIDResolutionOptions = {}) {
    return this.resolver.resolve(didUrl, options);
  }
}
