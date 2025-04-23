import Applesign from 'applesign';

const as = new Applesign({
  all: false,
  allDirs: false,
  allowHttp: false,
  addEntitlements: undefined,
  bundleIdKeychainGroup: false,
  bundleid: 'com.mcp.wda',
  cloneEntitlements: false,
  customKeychainGroup: undefined,
  debug: '',
  deviceProvision: false,
  entitlement: undefined,
  entry: false,
  file: '/Users/saikrishna/Documents/git/wda-mcp/node_modules/appium-webdriveragent/appium_wda_ios/Build/Products/Debug-iphoneos/Payload.ipa',
  forceFamily: false,
  identity: undefined,
  ignoreZipErrors: false,
  insertLibrary: undefined,
  json: undefined,
  keychain: undefined,
  lipoArch: undefined,
  massageEntitlements: false,
  mobileprovision:
    '/Users/saikrishna/Library/Developer/Xcode/UserData/Provisioning Profiles/810.mobileprovision',
  noEntitlementsFile: undefined,
  noclean: false,
  osversion: undefined,
  outfile: '',
  parallel: false,
  pseudoSign: false,
  replaceipa: false,
  run: undefined,
  selfSignedProvision: false,
  single: false,
  unfairPlay: false,
  use7zip: false,
  useOpenSSL: undefined,
  verify: false,
  verifyTwice: false,
  withGetTaskAllow: true,
  withoutPlugins: true,
  withoutSigningFiles: false,
  withoutWatchapp: false,
  withoutXCTests: false,
});
as.events
  .on('warning', (msg) => {
    console.log('WARNING', msg);
  })
  .on('message', (msg) => {
    console.log('msg', msg);
  });

as.signIPA(
  '/Users/saikrishna/Documents/git/wda-mcp/node_modules/appium-webdriveragent/appium_wda_ios/Build/Products/Debug-iphoneos/Payload.ipa'
)
  .then((_) => {
    console.log('DOne');
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
