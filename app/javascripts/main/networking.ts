import { IncomingMessage, net } from 'electron';
import fs from 'fs';
import path from 'path';
import { pipeline as pipelineFn } from 'stream';
import { promisify } from 'util';
import { MessageType } from '../../../test/TestIpcMessage';
import { ensureDirectoryExists } from './fileUtils';
import { handle } from './testing';
import { isTesting } from './utils';

const pipeline = promisify(pipelineFn);

if (isTesting()) {
  handle(MessageType.GetJSON, getJSON);
  handle(MessageType.DownloadFile, downloadFile);
}

/**
 * Downloads a file to the specified destination.
 * @param filePath path to the saved file (will be created if it does
 * not exist)
 */
export async function downloadFile(
  url: string,
  filePath: string
): Promise<void> {
  await ensureDirectoryExists(path.dirname(filePath));
  const response = await get(url);
  await pipeline(
    /**
     * IncomingMessage doesn't implement *every* property of ReadableStream
     * but still all the ones that pipeline needs
     * @see https://www.electronjs.org/docs/api/incoming-message
     */
    response as any,
    fs.createWriteStream(filePath)
  );
}

export async function getJSON<T>(url: string): Promise<T> {
  const response = await get(url);
  let data = '';
  return new Promise((resolve, reject) => {
    response
      .on('data', (chunk) => {
        data += chunk;
      })
      .on('error', reject)
      .on('end', () => {
        resolve(JSON.parse(data));
      });
  });
}

export function get(url: string): Promise<IncomingMessage> {
  const enum Method {
    Get = 'GET',
  }
  const enum RedirectMode {
    Follow = 'follow',
  }

  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = net.request({
      url,
      method: Method.Get,
      redirect: RedirectMode.Follow,
    });
    request.on('response', resolve);
    request.on('error', reject);
    request.end();
  });
}
