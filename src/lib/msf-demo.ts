export const demoModules = {
  exploits: [
    {
      name: "exploit/windows/smb/ms17_010_eternalblue",
      disclosureDate: "2017-03-14",
      rank: "average",
      description: "MS17-010 EternalBlue SMB Remote Windows Kernel Pool Corruption",
    },
    {
      name: "exploit/multi/http/log4shell_header_injection",
      disclosureDate: "2021-12-09",
      rank: "excellent",
      description: "Apache Log4j RCE via LDAP and JNDI injection",
    },
    {
      name: "exploit/linux/http/apache_mod_cgi_bash_env_exec",
      disclosureDate: "2014-09-24",
      rank: "excellent",
      description: "Apache mod_cgi Bash Environment Variable Code Injection (Shellshock)",
    },
  ],
  payloads: [
    {
      name: "windows/x64/meterpreter/reverse_tcp",
      rank: "normal",
      description: "Windows Meterpreter, Reverse TCP Stager",
    },
    {
      name: "linux/x64/meterpreter/reverse_tcp",
      rank: "normal",
      description: "Linux Meterpreter, Reverse TCP Stager",
    },
  ],
  auxiliary: [
    {
      name: "auxiliary/scanner/portscan/tcp",
      rank: "normal",
      description: "TCP Port Scanner",
    },
    {
      name: "auxiliary/scanner/ssh/ssh_login",
      rank: "normal",
      description: "SSH Login Check Scanner",
    },
  ],
};

export const demoSessions = [
  {
    id: 1,
    type: "meterpreter",
    tunnel: "10.0.0.5:4444 -> 192.168.1.42:49152",
    via: "exploit/windows/smb/ms17_010_eternalblue",
    info: "DESKTOP-LAB\\admin @ DESKTOP-LAB",
    workspace: "default",
  },
];

export const demoWorkspaces = [
  { name: "default", created_at: Date.now() / 1000 - 86400 },
  { name: "client-audit", created_at: Date.now() / 1000 - 3600 },
];

export const demoVersion = {
  version: "6.4.0-dev (demo)",
  ruby: "3.2.2",
  api: "1.0",
};
