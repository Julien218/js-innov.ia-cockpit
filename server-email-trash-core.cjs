function normalizedMailboxName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function flattenMailboxes(boxes, parent = '', output = []) {
  for (const [name, entry] of Object.entries(boxes || {})) {
    const delimiter = entry?.delimiter || '/';
    const fullName = parent ? `${parent}${delimiter}${name}` : name;
    output.push({
      name: fullName,
      attributes: (entry?.attribs || []).map((value) => String(value).toLowerCase()),
    });
    if (entry?.children) flattenMailboxes(entry.children, fullName, output);
  }
  return output;
}

function findTrashMailbox(boxes) {
  const mailboxes = flattenMailboxes(boxes);
  const specialUse = mailboxes.find((mailbox) => mailbox.attributes.includes('\\trash'));
  if (specialUse) return specialUse.name;

  const exactNames = new Set([
    'trash', 'corbeille', 'deleted', 'deleted items', 'deleted messages',
    'elements supprimes', 'messages supprimes', 'papierkorb',
  ]);
  const exact = mailboxes.find((mailbox) => {
    const leaf = normalizedMailboxName(mailbox.name.split(/[/.]/).pop());
    return exactNames.has(leaf);
  });
  return exact?.name || null;
}

module.exports = { flattenMailboxes, findTrashMailbox };
