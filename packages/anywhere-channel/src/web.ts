/** `@overdeck/anywhere-channel/web`: the protocol core plus the web crypto port and browser pieces. */
export * from './index.js';
export { webCrypto } from './crypto-web.js';
export { type ClientSignaling, createMachineDialer, type MachineDialer } from './dial-machine.js';
export { clientLabel, DirectoryWebClient, type DirectoryWebDeps, type DirectoryWebState } from './directory-web.js';
export { RTC_HIGH_WATER_BYTES, RTC_LOW_WATER_BYTES, RTC_MAX_MESSAGE_BYTES, RtcDuplexWeb } from './rtc-duplex-web.js';
export { openSecureChannel, type SecureChannel, type WebChannelOptions } from './secure-channel-web.js';
export {
  CHANNEL_POOL_IDLE_MS,
  CHANNEL_POOL_MAX,
  type ChannelDial,
  ChannelHttpError,
  type ChannelPool,
  type ChannelStream,
  createChannelPool,
  requestOnChannel,
} from './http-client.js';
export {
  CHANNEL_HOST,
  HttpParseError,
  type HttpRequest,
  type HttpResponse,
  MAX_RESPONSE_BODY_BYTES,
  ResponseParser,
  serializeRequest,
} from './http1.js';
export {
  channelPathFor,
  type ChannelShimOptions,
  installChannelShims,
  type ShimLocation,
  type ShimMachine,
} from './shims.js';
export {
  ChannelCloseEvent,
  ChannelMessageEvent,
  ChannelWebSocket,
  type ChannelWebSocketOptions,
} from './ws-client.js';
