/** `@overdeck/anywhere-channel/web`: the protocol core plus the web crypto port and browser pieces. */
export * from './index.js';
export { webCrypto } from './crypto-web.js';
export { openSecureChannel, type SecureChannel, type WebChannelOptions } from './secure-channel-web.js';
