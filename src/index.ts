#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import path from 'path';
import util from 'util';
import fs from 'fs';
import Applesign from 'applesign';
import archiver from 'archiver';
import os from 'os';
import { provision } from 'ios-mobileprovision-finder';
import { resolve } from 'path';

import { BOOTSTRAP_PATH } from 'appium-webdriveragent';

const execAsync = util.promisify(exec);
const WDA_BUILD_PATH = '/appium_wda_ios/Build/Products/Debug-iphoneos';

// Helper functions from the original code
async function getXcodeMajorVersion(): Promise<number> {
  const { stdout } = await execAsync('xcodebuild -version');
  const match = stdout.match(/Xcode (\d+)\./);
  if (!match) {
    throw new Error('Unable to determine Xcode version');
  }
  return parseInt(match[1], 10);
}

async function getProvisioningProfilePath(): Promise<string> {
  const xcodeVersion = await getXcodeMajorVersion();

  if (xcodeVersion <= 15) {
    return path.join(
      os.homedir(),
      'Library/MobileDevice/Provisioning Profiles'
    );
  } else {
    return path.join(
      os.homedir(),
      'Library/Developer/Xcode/UserData/Provisioning Profiles'
    );
  }
}

async function getMobileProvisioningFile(): Promise<
  { value: string; name: string; bundleId: string; filePath: string }[]
> {
  const provisionFileDir = await getProvisioningProfilePath();

  if (!fs.existsSync(provisionFileDir)) {
    throw new Error(
      `Provisioning directory does not exist: ${provisionFileDir}`
    );
  }

  const files = fs
    .readdirSync(provisionFileDir, { encoding: 'utf8' })
    .filter((file) => file.endsWith('.mobileprovision'));

  const provisioningFiles = files.map((file) => {
    const fullPath = path.join(provisionFileDir, file);
    const mp = provision.readFromFile(fullPath);
    return { ...mp, _filePath: fullPath };
  });

  if (!provisioningFiles || !provisioningFiles.length) {
    throw new Error('No mobileprovision file found on the machine');
  }

  const choices = provisioningFiles.map((file) => ({
    value: file.UUID,
    name: `${file.Name.split(':')[1] || file.Name} (Team: ${file.TeamName}) (${
      file.UUID
    })`,
    bundleId: file.Name.split(':')[1]?.trimStart(),
    filePath: file._filePath,
  }));
  return choices;
}

async function getWdaProject(): Promise<string> {
  try {
    return BOOTSTRAP_PATH;
  } catch (err) {
    console.error('Error finding WebDriverAgent project:', err);
    throw new Error('Unable to find WebDriverAgent project');
  }
}

async function buildWebDriverAgent(projectDir: string): Promise<string> {
  try {
    const buildCommand =
      'xcodebuild clean build-for-testing -project WebDriverAgent.xcodeproj -derivedDataPath appium_wda_ios -scheme WebDriverAgentRunner -destination generic/platform=iOS CODE_SIGNING_ALLOWED=NO';
    await execAsync(buildCommand, { cwd: projectDir, maxBuffer: undefined });
    return `${projectDir}/${WDA_BUILD_PATH}/WebDriverAgentRunner-Runner.app`;
  } catch (error) {
    throw new Error(
      `Error building WebDriverAgent: ${(error as any)?.message}`
    );
  }
}

async function zipPayloadDirectory(
  outputZipPath: string,
  folderPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(folderPath, 'Payload');
    archive.finalize();
  });
}

// Store selected provisioning profile and account type
interface SessionState {
  selectedProvisioningProfile?: {
    value: string;
    name: string;
    bundleId: string;
    filePath: string;
  };
  isFreeAccount?: boolean;
  wdaProjectPath?: string;
}

class WebDriverAgentServer {
  private server: Server;
  private sessionState: SessionState = {};

  constructor() {
    this.server = new Server(
      {
        name: 'wda-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_provisioning_profiles',
          description: `List all provisioning profiles in the system.
           Ask user to select from one of the listed profiles.
           Don't assume or select any profile without asking the user.
           Use the UUID of the selected profile to check the account type in next tool 'is_free_account'.
           `,
          inputSchema: {
            type: 'object',
            properties: {
              profileUuid: {
                type: 'string',
                description: 'UUID of the selected provisioning profile',
              },
            },
            required: ['profileUuid'],
          },
        },
        {
          name: 'is_free_account',
          description: `Ask user to confirm if the selected provisioning profile is a free account or an enterprise account.
           Don't assume the account type based on the UUID without asking the user.
           `,
          inputSchema: {
            type: 'object',
            properties: {
              isFreeAccount: {
                type: 'boolean',
                description:
                  'check whether the profile selected from tool list_provisioning_profiles is a free account provisioning profile (true) or an enterprise account (false)',
              },
            },
            required: ['isFreeAccount'],
          },
        },
        {
          name: 'build_and_sign_wda',
          description:
            'Build and sign WebDriverAgent for iOS using the selected provisioning profile',
          inputSchema: {
            type: 'object',
            properties: {
              selectedProvisioningProfile: {
                type: 'object',
                description:
                  'Selected provisioning profile from the tool list_provisioning_profiles that includes the UUID, name, bundleId and filePath',
              },
              isFreeAccount: {
                type: 'boolean',
                description:
                  'Whether this is a free account provisioning profile (true) or an enterprise account (false)',
              },
            },
            required: ['selectedProvisioningProfile', 'isFreeAccount'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments as any;

      try {
        switch (toolName) {
          case 'list_provisioning_profiles':
            return await this.handleListProvisioningProfiles();
          case 'is_free_account':
            return await this.isFreeAccount(args);
          case 'build_and_sign_wda':
            return await this.handleBuildAndSignWda(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${toolName}`
            );
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleListProvisioningProfiles() {
    // Get all provisioning profiles
    const provisioningProfiles = await getMobileProvisioningFile();

    // Clear any previously selected profile
    this.sessionState.selectedProvisioningProfile = undefined;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: 'Please select a provisioning profile',
              profiles: provisioningProfiles,
              instructions:
                "Use the 'is_free_account' tool with the selected profile UUID to ask user to confirm the account type is free or enterprise",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async isFreeAccount(args: any) {
    // Store the account type
    this.sessionState.isFreeAccount = args.isFreeAccount;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: `Please select the account type: Free Account or Enterprise Account`,
              instructions:
                "call the tool 'build_and_sign_wda' with the selected profile and account type",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleBuildAndSignWda(args: any) {
    // Get the profile UUID and account type from the arguments
    const profile = args.selectedProvisioningProfile;
    const isFreeAccount = args.isFreeAccount;

    // Step 1: Find the WebDriverAgent project
    const resolvedWdaPath = await getWdaProject();

    // Step 2: Build WebDriverAgent
    const wdaAppPath = await buildWebDriverAgent(resolvedWdaPath);

    // Step 3: Prepare WebDriverAgent IPA
    const wdaBuildPath = path.join(resolvedWdaPath, WDA_BUILD_PATH);
    const payloadDirectory = path.join(wdaBuildPath, 'Payload');

    // Remove framework directory
    fs.readdirSync(`${wdaAppPath}/Frameworks`).forEach((f) =>
      fs.rmSync(`${wdaAppPath}/Frameworks/${f}`, { recursive: true })
    );

    // Create Payload directory
    await execAsync(`mkdir -p ${payloadDirectory}`);

    // Move .app file to Payload directory
    await execAsync(`mv ${wdaAppPath} ${payloadDirectory}`);

    // Pack Payload directory
    await zipPayloadDirectory(`${wdaBuildPath}/Payload.ipa`, payloadDirectory);

    // Step 4: Sign WebDriverAgent IPA
    const ipaPath = `${wdaBuildPath}/Payload.ipa`;

    let appleOptions: any = {
      all: false,
      allDirs: false,
      allowHttp: false,
      addEntitlements: undefined,
      bundleIdKeychainGroup: false,
      bundleid: isFreeAccount
        ? profile.bundleId?.replace(/^\s+|\s+$/g, '')
        : '',
      cloneEntitlements: false,
      customKeychainGroup: undefined,
      debug: '',
      deviceProvision: false,
      entitlement: undefined,
      entry: false,
      file: ipaPath,
      forceFamily: false,
      identity: undefined,
      ignoreZipErrors: false,
      insertLibrary: undefined,
      json: undefined,
      keychain: undefined,
      lipoArch: undefined,
      massageEntitlements: false,
      mobileprovision: profile.filePath,
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
    };

    const as = new Applesign(appleOptions);
    await as.signIPA(ipaPath);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: 'WebDriverAgent successfully built and signed',
              resignedIpaPath: `${wdaBuildPath}/Payload-resigned.ipa`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('WebDriverAgent MCP server running on stdio');
  }
}

const server = new WebDriverAgentServer();
server.run().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
