# Chrome Web Store listing draft

Copy the text below into the Chrome Web Store dashboard. This file does not publish the extension.

After this file is on `main`, the privacy policy URL can be:

<https://github.com/mengfei0053/SampleProxy/blob/main/PRIVACY.md>

The package version for this first store release is `1.0.0` in `extension/manifest.json`.

## English

### Short description

Switch Chrome between direct, system, or a proxy you enter. Inspired by SwitchyOmega; unofficial and unaffiliated.

### Detailed description

SampleProxy switches Chrome between a direct connection, the operating system proxy, and a proxy server you enter. It is inspired by the kind of quick proxy switching people know from SwitchyOmega. It is unofficial, not affiliated with SwitchyOmega, and not derived from SwitchyOmega's code.

You can:

- Choose Direct, the system proxy, or a fixed HTTP, HTTPS, SOCKS4, or SOCKS5 server.
- Add and edit a proxy from the toolbar popup, including host, port, and a bypass list.
- Skip matching hosts, including `*.example.com` and CIDR ranges such as `10.0.0.0/8`.
- Let auto switch pick a profile per site with host rules.
- See ON or OFF on the toolbar badge, and the full profile name when you hover the icon.

Proxy hosts, rules, and optional HTTP or HTTPS sign-in details are what you type. They stay in `chrome.storage.local` on this computer. SampleProxy does not collect browsing history, does not use analytics, and does not load remote code.

Use a proxy server you trust. A proxy can see the traffic you send through it.

### Permission justifications

**proxy**

Required to apply the connection the user selects: direct, the operating system proxy, a fixed proxy server, or a locally generated PAC script for auto switch and CIDR bypass. SampleProxy changes Chrome's proxy settings only for that purpose.

**storage**

Required to save the user's profiles, rules, and bypass lists in `chrome.storage.local` on this device. The data is not synced and is not sent to a server.

The package also requests `webRequest`, `webRequestAuthProvider`, `activeTab`, and host access to all URLs. Those exist so Chrome can ask the extension for an HTTP or HTTPS proxy's own sign-in, and so the open popup can show which profile the current site would use. The extension does not read page bodies or store the tab address. See [PRIVACY.md](PRIVACY.md).

## 中文

### 简短说明

在直连、系统代理和你填写的代理之间切换。受 SwitchyOmega 启发，非官方且无关联。

### 详细说明

SampleProxy 用来在直连、操作系统代理，以及你自己填写的代理服务器之间切换 Chrome 的连接。它受人们在 SwitchyOmega 里熟悉的那种快速切换启发。它是非官方实现，与 SwitchyOmega 没有隶属、背书或源码派生关系。

你可以：

- 选择直连、系统代理，或固定的 HTTP、HTTPS、SOCKS4、SOCKS5 服务器。
- 在工具栏弹窗里添加和编辑代理，包括主机、端口和绕过列表。
- 让匹配的主机不走代理，包括 `*.example.com` 和 `10.0.0.0/8` 这类 CIDR。
- 用自动切换按网站规则选择配置。
- 在工具栏角标上看见 ON 或 OFF，鼠标悬停时看见完整配置名。

代理主机、规则，以及 HTTP 或 HTTPS 的可选登录信息，都是你自己填写的。它们保存在这台电脑的 `chrome.storage.local`。SampleProxy 不收集浏览历史，不使用统计分析，也不加载远程代码。

请只使用你信任的代理服务器。代理可以看到经它转发的流量。

### 权限说明

**proxy**

用来应用用户选择的连接：直连、操作系统代理、固定代理，或为本机生成的自动切换与 CIDR 绕过 PAC 脚本。SampleProxy 只为这个目的修改 Chrome 的代理设置。

**storage**

用来把用户的配置、规则和绕过列表保存在本机的 `chrome.storage.local`。这些数据不会同步，也不会发到服务器。

安装包还会请求 `webRequest`、`webRequestAuthProvider`、`activeTab`，以及所有网址的主机权限。它们用于回答 HTTP 或 HTTPS 代理自己的登录提示，并在弹窗打开时显示当前网站会走哪个配置。扩展不读取页面正文，也不保存标签页地址。详见 [PRIVACY.md](PRIVACY.md)。
