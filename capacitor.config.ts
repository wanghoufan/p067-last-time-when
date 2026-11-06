import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wanghoufan.whenlast',
  appName: '上次啥时候',
  webDir: 'dist',
  android: {
    backgroundColor: '#f6f7fa',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#f6f7fa',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
  },
};

export default config;
