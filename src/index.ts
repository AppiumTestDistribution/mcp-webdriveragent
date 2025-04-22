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

async function getMobileProvisioningFile(
  mobileProvisioningFile?: string
): Promise<string> {
  if (mobileProvisioningFile) {
    if (
      !fs.existsSync(mobileProvisioningFile) ||
      !fs.statSync(mobileProvisioningFile).isFile()
    ) {
      throw new Error(
        `Mobile provisioning file ${mobileProvisioningFile} does not exist`
      );
    }
    return mobileProvisioningFile;
  } else {
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

    // Return the first provisioning profile for now
    // In a real implementation, we would need to handle selection
    return provisioningFiles[0]._filePath;
  }
}

async function getWdaProject(wdaProjectPath?: string): Promise<string> {
  if (wdaProjectPath) {
    if (
      !fs.existsSync(wdaProjectPath) ||
      !fs.statSync(wdaProjectPath).isDirectory()
    ) {
      throw new Error(
        `Unable to find webdriver agent project in path ${wdaProjectPath}`
      );
    }
    return wdaProjectPath;
  }

  try {
    const { stdout } = await execAsync(
      'find $HOME/.appium -name WebDriverAgent.xcodeproj'
    );
    return stdout;
  } catch (err) {
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

class WebDriverAgentServer {
  private server: Server;

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
          name: 'build_and_sign_wda',
          description: 'Build and sign WebDriverAgent for iOS',
          inputSchema: {
            type: 'object',
            properties: {
              mobileProvisioningFile: {
                type: 'string',
                description:
                  'Path to the mobile provisioning file which is used to sign the webdriver agent (optional)',
              },
              wdaProjectPath: {
                type: 'string',
                description: 'Path to webdriver agent xcode project (optional)',
              },
              isFreeAccount: {
                type: 'boolean',
                description:
                  'Whether this is a free account provisioning profile',
              },
              bundleId: {
                type: 'string',
                description:
                  'Bundle ID to use for signing (required for free accounts)',
              },
            },
            required: ['isFreeAccount'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'build_and_sign_wda') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      const args = request.params.arguments as any;

      try {
        // Step 1: Get the mobile provisioning file
        const mobileProvisioningFile = await getMobileProvisioningFile(
          args.mobileProvisioningFile
        );

        // Step 2: Find the WebDriverAgent project
        const wdaProjectPath = await getWdaProject(args.wdaProjectPath);

        // Step 3: Build WebDriverAgent
        const wdaAppPath = await buildWebDriverAgent(wdaProjectPath);

        // Step 4: Prepare WebDriverAgent IPA
        const wdaBuildPath = path.join(wdaProjectPath, WDA_BUILD_PATH);
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
        await zipPayloadDirectory(
          `${wdaBuildPath}/wda-resign.zip`,
          payloadDirectory
        );

        // Step 5: Sign WebDriverAgent IPA
        const ipaPath = `${wdaBuildPath}/wda-resign.ipa`;

        let appleOptions: any;
        if (args.isFreeAccount) {
          if (!args.bundleId) {
            throw new Error('Bundle ID is required for free accounts');
          }
          appleOptions = {
            mobileprovision: mobileProvisioningFile,
            outfile: ipaPath,
            bundleId: args.bundleId.replace(/^\s+|\s+$/g, ''),
          };
        } else {
          appleOptions = {
            mobileprovision: mobileProvisioningFile,
            outfile: ipaPath,
          };
        }

        const as = new Applesign(appleOptions);
        await as.signIPA(path.join(wdaBuildPath, 'wda-resign.zip'));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'success',
                  message: 'WebDriverAgent successfully built and signed',
                  ipaPath: ipaPath,
                  wdaProjectPath: wdaProjectPath,
                },
                null,
                2
              ),
            },
          ],
        };
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('WebDriverAgent MCP server running on stdio');
  }
}

const server = new WebDriverAgentServer();
server.run().catch(console.error);
