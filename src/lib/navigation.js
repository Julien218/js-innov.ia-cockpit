export function isNavigationActive(pathname, target) {
  return pathname === target || (target !== '/' && pathname.startsWith(`${target}/`));
}

export function navigationPath(path, role) {
  return role === 'client' ? ({ '/projets': '/mes-projets', '/devis': '/mes-devis', '/factures': '/mes-factures' }[path] || path) : path;
}

export function searchNavigation(groups, query, { role, canAccess, insuranceAllowed = false }) {
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return groups.flatMap(group => group.items.map(item => ({ ...item, group: group.label, path: navigationPath(item.path, role) })))
    .filter(item => item.insuranceOnly ? insuranceAllowed : canAccess(item.path))
    .filter(item => words.every(word => normalize(`${item.label} ${item.group} ${item.path}`).includes(word)))
    .slice(0, 8);
}
