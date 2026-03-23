// passphrase.ts — Generates a random 3-word confirmation phrase for destructive actions

const WORDS = [
  "amber","anchor","anvil","arrow","atlas","basin","blade","blaze","bloom","bough",
  "brave","briar","brook","canoe","cedar","chain","chalk","cliff","cloak","cloud",
  "cobra","coral","crane","creek","crown","dagger","delta","depot","drake","dune",
  "ember","epoch","fable","falcon","fern","ferry","flare","flint","forge","frost",
  "gable","glade","globe","gloom","grove","gravel","haven","hawk","heron","holly",
  "inlet","ivory","jasper","jetty","kindle","knoll","lathe","lemon","lever","lodge",
  "maple","march","marsh","manor","meteor","mill","mist","moat","moss","mount",
  "noble","notch","oaken","orbit","otter","ovate","parch","pearl","perch","pilot",
  "plank","plaza","plume","polar","pond","quartz","quill","raven","reach","realm",
  "resin","ridge","rivet","robin","rudder","rustle","sable","scone","scout","shaft",
  "shale","shoal","shrub","siege","slate","slope","smoke","solar","spire","spoke",
  "sprig","stamp","stark","stern","stone","storm","stove","strap","straw","stride",
  "swift","sword","talon","taper","thatch","thorn","timber","titan","torch","tower",
  "trace","trail","trout","trunk","tunic","turret","vapor","vault","venom","vigor",
  "visor","vixen","walnut","warden","wedge","wheel","whirl","wicker","willow","winch",
];

export function generatePassphrase(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  let a = pick(), b = pick(), c = pick();
  while (b === a) b = pick();
  while (c === a || c === b) c = pick();
  return `${a}-${b}-${c}`;
}
