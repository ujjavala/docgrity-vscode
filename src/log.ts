/**
 * Central logger — a VS Code LogOutputChannel ("Docgrity" in the Output panel).
 * Log level is controlled by the user via the standard Developer: Set Log Level
 * command. Never log document contents, tokens, or credentials.
 */
import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function initLog(context: vscode.ExtensionContext): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel('Docgrity', { log: true });
  context.subscriptions.push(channel);
  return channel;
}

export const log = {
  trace: (msg: string, ...args: unknown[]) => channel?.trace(msg, ...args),
  debug: (msg: string, ...args: unknown[]) => channel?.debug(msg, ...args),
  info: (msg: string, ...args: unknown[]) => channel?.info(msg, ...args),
  warn: (msg: string, ...args: unknown[]) => channel?.warn(msg, ...args),
  error: (msg: string | Error, ...args: unknown[]) => channel?.error(msg, ...args),
};
