#!/usr/bin/env node

import { WebDriverAgentServer } from './wda';

// For backward compatibility
export const createServer = async () => {
  const server = new WebDriverAgentServer();
  return await server.run();
};

module.exports = { createServer };
