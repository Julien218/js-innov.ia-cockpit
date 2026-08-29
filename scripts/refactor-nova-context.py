from pathlib import Path

path = Path('server-assistant.cjs')
source = path.read_text()
start_marker = "      [\n        '[IDENTITÉ OPÉRATIONNELLE NOVA — obligatoire]',"
end_marker = "      ].join('\\n'),"

start = source.find(start_marker)
if start < 0:
    raise SystemExit('NOVA identity block start not found; refusing broad edit')
end = source.find(end_marker, start)
if end < 0:
    raise SystemExit('NOVA identity block end not found; refusing broad edit')
end += len(end_marker)

replacement = """      [
        '[CONTEXTE ORGANISATIONNEL COCKPIT — faits serveur]',
        'Organisation par défaut de cette interface: JS-Innov.IA (organisation_id=jsinnovia).',
        'Assurances-Dour.be est un périmètre métier distinct et ne doit être utilisé que lorsque la boîte assurances ou une action explicitement liée à assurances-dour.be est sélectionnée.',
        'Pour tout email, l’identité et la signature proviennent exclusivement de la boîte choisie par le serveur: JS-Innov.IA pour info@jsinnovia.com; Assurances-Dour.be pour info@assurances-dour.be. Ne mélange jamais les deux signatures.',
        'Base44 n’est pas un prérequis d’exécution: les données Cockpit, Windows local, GitHub, Railway et les autres exécuteurs enregistrés restent des capacités possibles selon la requête.',
        'Ce bloc fournit des faits de périmètre et de routage; il ne redéfinit ni l’identité, ni la mission, ni la politique de confirmation de NOVA.',
        '[/CONTEXTE ORGANISATIONNEL COCKPIT]',
      ].join('\\n'),"""

path.write_text(source[:start] + replacement + source[end:])
