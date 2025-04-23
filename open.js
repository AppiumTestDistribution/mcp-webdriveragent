import { resolve } from 'path';
import { exec } from 'teen_process';
import path from 'path';
import fs from 'fs';
import { provision } from 'ios-mobileprovision-finder';
import os from 'os';
import { BOOTSTRAP_PATH } from 'appium-webdriveragent';

async function openWda() {
  const dstPath = BOOTSTRAP_PATH;
  const provisionFileDir = path.join(
    os.homedir(),
    'Library/Developer/Xcode/UserData/Provisioning Profiles'
  );
  const files = fs
    .readdirSync(provisionFileDir, { encoding: 'utf8' })
    .filter((file) => file.endsWith('.mobileprovision'));

  const provisioningFiles = files.map((file) => {
    const fullPath = path.join(provisionFileDir, file);
    const mp = provision.readFromFile(fullPath);
    return { ...mp, _filePath: fullPath };
  });
  const choices = provisioningFiles.map((file) => ({
    value: file.UUID,
    name: `${file.Name.split(':')[1] || file.Name} (Team: ${file.TeamName}) (${
      file.UUID
    })`,
    bundleId: file.Name.split(':')[1]?.trimStart(),
    filePath: file._filePath,
  }));
  console.log(choices);
  //await exec('open', [dstPath]);
}

(async () => await openWda())();
