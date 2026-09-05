/**
 * Interactive model picker — lists every model available through vscode.lm
 * (Copilot models, Claude/GPT/Gemini via Copilot model picker, Ollama models
 * added via BYOK, other provider extensions) and saves the choice to settings.
 */
import * as vscode from 'vscode';
import { log } from '../log';

export async function selectModelCommand(): Promise<void> {
  const models = await vscode.lm.selectChatModels({});
  if (models.length === 0) {
    const openDocs = 'Setup guide';
    const pick = await vscode.window.showErrorMessage(
      'Docgrity: no language models available. Sign in to GitHub Copilot, or add a local model ' +
        '(e.g. Ollama) via Copilot Chat → Manage models.',
      openDocs
    );
    if (pick === openDocs) {
      void vscode.env.openExternal(
        vscode.Uri.parse('https://ujjavala.github.io/docgrity-vscode-site/how-it-works.html#models')
      );
    }
    return;
  }

  const cfg = vscode.workspace.getConfiguration('docgrity');
  const currentVendor = cfg.get<string>('model.vendor', 'copilot');
  const currentFamily = cfg.get<string>('model.family', '');

  const items = models.map((m) => ({
    label: m.name || m.family,
    description: `${m.vendor} · family: ${m.family}`,
    detail:
      m.vendor === currentVendor && m.family === currentFamily ? 'Current Docgrity model' : undefined,
    model: m,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Which model should Docgrity use for scans? (Copilot, Claude, GPT, local Ollama…)',
    matchOnDescription: true,
  });
  if (!pick) return;

  await cfg.update('model.vendor', pick.model.vendor, vscode.ConfigurationTarget.Global);
  await cfg.update('model.family', pick.model.family, vscode.ConfigurationTarget.Global);
  log.info(`Model configured: vendor=${pick.model.vendor}, family=${pick.model.family}`);
  void vscode.window.showInformationMessage(
    `Docgrity will use ${pick.label} (${pick.model.vendor}/${pick.model.family}).`
  );
}
