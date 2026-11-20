// lib/domain/topics.ts — the classifier's topic list.
//
// It lives in the domain layer so the live analyzer (lib/engine.ts) and the
// read model (lib/application/analytics.ts) agree on what a "topic" is.

const MOBILE_RX = /\bios\b|\bandroid\b|\bswift(ui)?\b|\bkotlin\b|\bflutter\b|\bdart\b|react native|\bexpo\b|app store|play store|testflight|mobile apps?\b|\bxcode\b|\bapk\b/;
const SAAS_RX = /\bsaas\b|\bstartups?\b|\bindie ?hack|\bmrr\b|\barr\b|bootstrap(ped|ping)|\bfounders?\b|product hunt|\bchurn\b|\bmicro[- ]?saas\b|\bpaying (users|customers)\b|\bcustomers?\b|\brevenue\b|\bvalidat(e|ed|ing|ion)\b/;

export const TOPICS: [string, RegExp][] = [
  ['AI & LLMs', /\bai\b|\bllm\b|\bllms\b|\bgpt\b|\bclaude\b|\bgemini\b|\bmachine learning\b|openai|anthropic|neural|\bfine[- ]?tun(e|ing)\b/],
  ['Python', /\bpython\b|pypi|pandas\b|django|flask|fastapi|pytest/],
  ['JS / Web / Frontend', /\bjavascript\b|\btypescript\b|\breact\b|\bnode\b|\bvue\b|\bsvelte\b|\bangular\b|\bhtml\b|\bcss\b|frontend|web ?dev|browser|\btailwind\b/],
  ['DevOps & Cloud', /\bdevops\b|\bci\/cd\b|github actions|\bkubernetes\b|\bk8s\b|\bdocker\b|AWS\b|azure\b|\bgcp\b|terraform|cloud|\bdeploy/],
  ['Cybersecurity', /\bsecurity\b|infosec|cyber|\bcve\b|vulnerab|zero[- ]?day|0day|\bpatch(ed|ing)?\b|advisory/],
  ['Hacking & Exploits', /\bhack|exploit|\bbreach\b|\bpwn|pentest|bug ?bounty|\bxss\b|\bsqli\b|\bssrf\b|\bmalware\b|\bransomware\b|\bphishing\b|\breverse engineer|\bred team\b/],
  ['Privacy & OSINT', /\bprivacy\b|\bosint\b|surveillance|forensic|\bleak(ed)?\b|tracking|gdpr|\bdox/],
  ['Auth & Identity', /\bpassword\b|\bcredentials?\b|\bauth(entication)?\b|\b2fa\b|\bmfa\b|oauth|sso\b/],
  ['Databases', /\bdatabase\b|\bsql\b|postgres|mysql|sqlite|mongo|redis\b|\bschema\b/],
  ['Rust / Go / Systems', /\brust\w*\b|golang|\bkernel\b|\bc\+\+\b|\bcpp\b|systems program|memory safety|\bleak(ing)? (memory|ptr)/],
  ['Career & Growth', /\bcareer\b|\bjob\b|\bjobs\b|\binterview\b|productiv|burnout|remote work|salary|freelanc|\bside project\b|build in public/],
  ['Mobile Dev', MOBILE_RX],
  ['SaaS & Startups', SAAS_RX],
  ['Tools & Launches', /launch(ed|ing)?\b|monetiz|\bpricing\b|\breleased?\b|\bnew tool\b|\bv1\b|\bbeta\b|\bshipped\b/],
];

/** The topic names, in the order the classifier applies them. */
export const TOPIC_NAMES = TOPICS.map(([name]) => name);
