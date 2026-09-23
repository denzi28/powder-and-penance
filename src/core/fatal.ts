/** Replace the page with a readable error (bad data files, missing assets). */
export function showFatal(message: string) {
  const pre = document.createElement('pre');
  pre.id = 'fatal';
  pre.textContent = `Powder & Penance could not start.\n\n${message}\n\nFix the file(s) above and save; the page reloads automatically.`;
  document.body.replaceChildren(pre);
  console.error(message);
}
