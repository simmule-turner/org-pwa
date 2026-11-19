// @ts-check
/** The lines of `list-buffers` (`C-x C-b`): the flags, the name and the file of each open buffer, as Emacs sets them out.
 * @param {{ name: string, modified: boolean, file: string }[]} buffers @param {number} current index of the buffer shown */
export function bufferListLines(buffers, current) {
  const width = Math.max(6, ...buffers.map((b) => b.name.length));
  const lines = [`CRM ${'Buffer'.padEnd(width)}  File`, `--- ${'------'.padEnd(width)}  ----`];
  buffers.forEach((b, i) => lines.push(`${i === current ? '.' : ' '}${b.modified ? '*' : ' '}  ${b.name.padEnd(width)}  ${b.file}`.trimEnd()));
  return lines;
}
