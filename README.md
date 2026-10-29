# SampleProxy

SampleProxy is a small Chrome extension for switching the browser's proxy. It can use a direct connection, the operating system proxy, or a fixed HTTP, HTTPS, SOCKS4, or SOCKS5 server. Optional host rules send matching sites to different profiles.

SampleProxy 是一个用于切换浏览器代理的小型 Chrome 扩展。它可以直连、使用操作系统代理，或连接固定的 HTTP、HTTPS、SOCKS4、SOCKS5 服务器。也可以按主机名规则把不同网站分到不同的配置。

This project is not affiliated with, endorsed by, or derived from SwitchyOmega. It is an independent Manifest V3 implementation.

本项目与 SwitchyOmega 没有隶属、背书或源码派生关系，是一个独立的 Manifest V3 实现。

## English

### Load the unpacked extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension` folder in this repository (the folder that contains `manifest.json`, not the repository root).
5. Pin **SampleProxy** from the puzzle-piece menu so the badge stays visible.

Chrome copies nothing and does not need a build step. After you change the files, click **Reload** on the extension card.

### Switch Direct and SOCKS5

1. Click the toolbar icon, then **Add proxy**. The form starts as SOCKS5 on `127.0.0.1` port `1080`. Set the name, type (SOCKS5, SOCKS4, HTTP, or HTTPS), host, and port. HTTP and HTTPS can also store a username and password. Click **Save**.
2. The profile appears in the popup list. Click it to use it. **Edit** on that row changes the same fields later.
3. **Proxy settings** still opens the full page. **New proxy** there creates the same kind of profile, and that page is where bypass lists, badge colors, and auto-switch rules are edited. Text fields on that page save about half a second after you stop typing.
4. The badge shows a short code for the proxy type (`SOCK`, `S4`, `HTTP`, or `HTTPS`), in that profile's color. Hover the icon for the full name and server. **Direct** shows `DIR`.
5. Click **Direct** in the popup when you want a connection with no proxy.

Built-in Direct and System profiles cannot be edited or deleted. Auto switch is not a proxy profile, so the popup does not edit it here.

### Auto switch

Auto switch builds a PAC script and gives it to Chrome (`chrome.proxy` mode `pac_script`). In **Proxy settings**, add rules, choose the default profile, then click **Use auto switch**. The popup shows which profile the current http(s) tab would use.

| Pattern | Matches | Does not match |
| --- | --- | --- |
| `example.com` | `example.com` | `www.example.com` |
| `*.example.com` | `example.com`, `www.example.com`, `a.b.example.com` | `example.com.evil.test`, `notexample.com` |
| `.example.com` | `www.example.com` and deeper subdomains | `example.com` |
| `example.com:443` | that host on port 443 | the same host on another port |

The first matching rule wins. Each fixed profile also has a bypass list: hosts on that list connect directly even when a rule selects the profile. `<local>` matches single-label names such as `localhost`.

The System profile cannot be the default or a rule target. A PAC script has no result that means "use the operating system proxy."

### Toolbar badge

| Badge | Meaning |
| --- | --- |
| `DIR` | Direct connection |
| `SYS` | Operating system proxy |
| `AUTO` | Auto switch |
| `ERR` | The latest settings were not applied. The previous working proxy stays in place. |
| `SOCK` | SOCKS5 |
| `S4` | SOCKS4 |
| `HTTP` | HTTP |
| `HTTPS` | HTTPS |

Hover the toolbar icon for the full profile name and `scheme · host:port`. The popup list is where the long name is shown.

### Permissions

| Permission | Why it is requested |
| --- | --- |
| `proxy` | Set Chrome's proxy configuration. |
| `storage` | Save profiles in `chrome.storage.local` on this computer. Nothing is synced and the extension has no server. |
| `webRequest` and `webRequestAuthProvider` | Answer an HTTP or HTTPS proxy's own sign-in prompt. The listener ignores ordinary website logins (`details.isProxy` must be true) and sends the saved username and password only when the prompt comes from that proxy's host and port. |
| `<all_urls>` | Chrome only reports those sign-in prompts for addresses the extension is allowed to see. A proxy can be used for any site, so the permission is broad. The code does not read page bodies, inject scripts, or upload browsing history. |
| `activeTab` | While the popup is open, read the current tab's host so the popup can show which profile that site would use. The address is not stored. |

Chrome's install prompt will describe the broad site access in its own words. Removing the extension releases its control of the proxy settings.

HTTP and HTTPS proxies can use a username and password. Chrome does not support SOCKS username/password authentication, so those fields are disabled for SOCKS4 and SOCKS5 and are not sent. Proxy passwords are stored in the browser profile's local extension storage. This extension does not encrypt them itself; do not save one in a shared browser profile.

International host names must be entered in ASCII punycode. `127.0.0.1:1080` belongs in the host and port fields separately; pasting `127.0.0.1:9050` into the host field is left as a host error rather than guessed.

If another extension or an enterprise policy already controls the proxy, Chrome rejects the change and the badge shows `ERR`.

To use the same switch in Incognito, open the extension's details page and allow it in Incognito.

### Development

From the repository root, with Node.js 22 or newer:

```bash
node --test
```

No packages are installed. `node --test` checks profile normalization, proxy configuration, PAC generation, and the rule that proxy passwords never enter the PAC script.

### Disclaimer

SampleProxy is not affiliated with SwitchyOmega. Proxy servers can see the traffic you send through them. Use a server you trust. The software is provided under the MIT license, without warranty.

## 中文

### 加载未打包的扩展

1. 打开 `chrome://extensions`。
2. 打开**开发者模式**。
3. 点击**加载已解压的扩展程序**。
4. 选择本仓库中的 `extension` 文件夹（里面有 `manifest.json` 的那一层，不是仓库根目录）。
5. 在拼图菜单里固定 **SampleProxy**，方便看到工具栏角标。

不需要构建。修改文件后，在扩展卡片上点击**重新加载**。

### 在直连和 SOCKS5 之间切换

1. 点击工具栏图标，再点 **Add proxy**（添加代理）。表单默认是 `127.0.0.1` 端口 `1080` 的 SOCKS5。填写名称、类型（SOCKS5、SOCKS4、HTTP 或 HTTPS）、主机和端口。HTTP 和 HTTPS 还可以填写用户名和密码。点击 **Save**（保存）。
2. 配置会出现在弹窗列表里。点击它即可使用。该行的 **Edit**（编辑）以后可以改同样的字段。
3. **Proxy settings**（代理设置）仍然打开完整设置页。那里的 **New proxy**（新建代理）会建立同一种配置；绕过列表、角标颜色和自动切换规则在设置页修改。设置页的文本大约在停止输入半秒后写入。
4. 角标显示代理类型的短代码（`SOCK`、`S4`、`HTTP` 或 `HTTPS`），背景是该配置的颜色。鼠标悬停在图标上可以看到完整名称和服务器。直连显示 `DIR`。
5. 要取消代理时，在弹窗里点 **Direct**。

内置的 Direct（直连）和 System（系统代理）不能编辑或删除。Auto switch（自动切换）不是代理配置，弹窗里不能把它当成代理来编辑。

### 自动切换

自动切换会生成 PAC 脚本，并通过 `chrome.proxy` 的 `pac_script` 模式交给 Chrome。在设置页添加规则、选择默认配置，然后点击 **Use auto switch**。弹窗会显示当前 http(s) 标签页将使用哪个配置。

| 模式 | 匹配 | 不匹配 |
| --- | --- | --- |
| `example.com` | `example.com` | `www.example.com` |
| `*.example.com` | `example.com`、`www.example.com`、`a.b.example.com` | `example.com.evil.test`、`notexample.com` |
| `.example.com` | `www.example.com` 以及更深层的子域 | `example.com` |
| `example.com:443` | 该主机的 443 端口 | 同一主机的其他端口 |

第一条命中的规则生效。固定代理配置还有绕过列表：列表中的主机即使被规则选中也直接连接。`<local>` 匹配 `localhost` 这类没有点的主机名。

系统代理不能作为默认配置或规则目标。PAC 脚本没有“使用操作系统代理”这种返回值。

### 工具栏角标

| 角标 | 含义 |
| --- | --- |
| `DIR` | 直连 |
| `SYS` | 操作系统代理 |
| `AUTO` | 自动切换 |
| `ERR` | 最新设置没有生效。之前可用的代理保持不变。 |
| `SOCK` | SOCKS5 |
| `S4` | SOCKS4 |
| `HTTP` | HTTP |
| `HTTPS` | HTTPS |

鼠标悬停在工具栏图标上可以看到完整配置名和 `scheme · host:port`。长名称显示在弹窗列表里。

### 权限

| 权限 | 用途 |
| --- | --- |
| `proxy` | 设置 Chrome 的代理。 |
| `storage` | 把配置保存在本机的 `chrome.storage.local`。不同步，扩展也没有自己的服务器。 |
| `webRequest` 与 `webRequestAuthProvider` | 回答 HTTP 或 HTTPS 代理自己的登录提示。监听器忽略网站自己的登录（必须是 `details.isProxy`），并且只在提示来自该代理的主机和端口时送出保存的用户名和密码。 |
| `<all_urls>` | Chrome 只向有权查看相应地址的扩展报告这种登录提示。代理可能用于任意网站，所以这项权限范围较宽。代码不读取页面正文、不注入脚本、也不上传浏览记录。 |
| `activeTab` | 弹窗打开时读取当前标签页的主机名，用来显示该网站会走哪个配置。这个地址不会被保存。 |

安装时 Chrome 会用它自己的文案描述较宽的网站访问权限。删除扩展后，它不再控制代理设置。

HTTP 和 HTTPS 代理可以使用用户名和密码。Chrome 不支持 SOCKS 的用户名/密码认证，因此 SOCKS4 和 SOCKS5 会禁用这两个字段，也不会发送它们。代理密码保存在浏览器配置文件的扩展本地存储里。本扩展不会再做一层加密；不要把密码保存在与他人共用的浏览器配置中。

国际化域名请使用 ASCII punycode。主机和端口要分开填写。把 `127.0.0.1:9050` 整个粘贴进主机栏会被视为无效主机，而不会被猜测拆分。

如果已有其他扩展或企业策略控制代理，Chrome 会拒绝更改，角标显示 `ERR`。

若要在无痕窗口使用同一套切换，请在扩展详情页允许在无痕模式下运行。

### 开发

在仓库根目录使用 Node.js 22 或更新版本：

```bash
node --test
```

不需要安装依赖。测试覆盖配置整理、代理设置、PAC 生成，以及代理密码不会写入 PAC 脚本。

### 声明

SampleProxy 与 SwitchyOmega 无关。代理服务器可以看到经它转发的流量，请只使用你信任的服务器。本软件按 MIT 许可证提供，不含担保。

## License

MIT. See [LICENSE](LICENSE).
