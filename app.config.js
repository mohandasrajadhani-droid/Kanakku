// versionCode rises with every GitHub build, so each new APK installs as an update.
const build = Number(process.env.GITHUB_RUN_NUMBER || 1);

module.exports = {
  expo: {
    name: 'Kanakku',
    slug: 'kanakku',
    version: '1.2.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    newArchEnabled: false,
    backgroundColor: '#17110C',
    icon: './assets/icon.png',
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-foreground.png',
        backgroundImage: './assets/adaptive-background.png',
        monochromeImage: './assets/adaptive-monochrome.png',
      },
      package: 'com.mohandas.kanakku',
      versionCode: build,
      permissions: ['android.permission.READ_SMS', 'android.permission.RECEIVE_SMS'],
      backgroundColor: '#17110C',
      softwareKeyboardLayoutMode: 'resize',
    },
    plugins: ['./plugins/withFixedSigning'],
  },
};
