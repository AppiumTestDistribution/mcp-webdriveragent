import { resolve } from 'path';
import { exec } from 'teen_process';

import { BOOTSTRAP_PATH } from 'appium-webdriveragent';

async function openWda() {
  const dstPath = BOOTSTRAP_PATH;
  console.log(dstPath);
  //await exec('open', [dstPath]);
}

(async () => await openWda())();
