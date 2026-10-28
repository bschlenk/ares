import type { SettingDescriptor } from './contracts.js';
export const presentationSettings: readonly SettingDescriptor[] = [
  { id: 'presentation.theme', section: 'Presentation', title: 'Theme', type: 'enum', options: ['dark', 'paper', 'green'], default: 'dark', apply: 'live' },
  { id: 'presentation.scale', section: 'Presentation', title: 'Scaling', type: 'enum', options: ['fit', 'integer'], default: 'fit', apply: 'live' },
];

export const nativeRuntimeSettings: readonly SettingDescriptor[] = [
  { id: 'audio.volume', title: 'Volume', section: 'Audio', type: 'number', min: 0, max: 1, default: 0.4, apply: 'live', nativeKey: 'Audio/Volume' },
  { id: 'audio.mute', title: 'Mute', section: 'Audio', type: 'boolean', default: false, apply: 'live', nativeKey: 'Audio/Mute' },
  { id: 'video.luminance', control: 'slider', title: 'Luminance', section: 'Video', type: 'number', min: 0, max: 2, default: 1, apply: 'live', nativeKey: 'Video/Luminance' },
  { id: 'video.saturation', control: 'slider', title: 'Saturation', section: 'Video', type: 'number', min: 0, max: 2, default: 1, apply: 'live', nativeKey: 'Video/Saturation' },
  { id: 'video.gamma', control: 'slider', title: 'Gamma', section: 'Video', type: 'number', min: 0.1, max: 3, default: 1, apply: 'live', nativeKey: 'Video/Gamma' },
];

export const agentSettings: readonly SettingDescriptor[] = [
  { id: 'agent.enabled', section: 'Agent Integration', title: 'Enable MCP and CLI access', type: 'boolean', default: true, apply: 'live' },
  { id: 'debug.provenance', section: 'Agent Integration', title: 'Record N64 DMA provenance', type: 'boolean', default: false, apply: 'live' },
];
