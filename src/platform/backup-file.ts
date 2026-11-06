import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function downloadBackupInBrowser(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareBackupOnDevice(
  text: string,
  fileName: string,
  dialogTitle: string,
): Promise<boolean> {
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  try {
    await Share.share({ title: fileName, dialogTitle, files: [uri] });
    return true;
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) return false;
    throw error;
  }
}
