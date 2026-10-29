# Privacy policy

SampleProxy is a Chrome extension that switches the browser's proxy. This page describes what it does with data. The same statement is repeated in Chinese below.

## English

SampleProxy does not collect browsing history.

Proxy settings are entered by you. The extension does not download profiles, rules, or servers from the internet. You type the profile name, proxy type, host, port, bypass list, and, for an HTTP or HTTPS proxy, an optional username and password.

That information is stored only in `chrome.storage.local` on this device. This extension does not sync it, does not upload it, and has no server of its own.

SampleProxy does not use analytics. It does not load remote code. It does not include third-party tracking.

A few details follow from how Chrome works:

- While the popup is open, the extension may read the current tab's host so it can show which profile that site would use. That address is not stored.
- If an HTTP or HTTPS proxy asks Chrome to sign in, the username and password you saved are sent only to that proxy, and only when the prompt comes from that proxy. Ordinary website logins are ignored. SOCKS proxies do not receive a username or password.
- A proxy server you choose can see the traffic you send through it. That is the proxy's own visibility, not collection by SampleProxy.

Removing the extension removes its control of Chrome's proxy settings. Data in this browser profile's local extension storage goes away with the extension data for this profile.

Questions or privacy requests: open an issue at <https://github.com/mengfei0053/SampleProxy/issues>.

## 中文

SampleProxy 不收集浏览历史。

代理设置只由你自己填写。扩展不会从网上下载配置、规则或服务器地址。配置名称、代理类型、主机、端口、绕过列表，以及 HTTP 或 HTTPS 代理的可选用户名和密码，都是你输入的。

这些信息只保存在本机的 `chrome.storage.local`。本扩展不会同步它们，不会上传它们，也没有自己的服务器。

SampleProxy 不使用统计分析。它不加载远程代码。它不包含第三方追踪。

下面几项来自 Chrome 的工作方式：

- 弹窗打开时，扩展可能读取当前标签页的主机名，用来显示该网站会走哪个配置。这个地址不会被保存。
- 如果 HTTP 或 HTTPS 代理要求 Chrome 登录，你保存的用户名和密码只发给该代理，并且只在提示来自该代理时发送。网站自己的登录会被忽略。SOCKS 代理不会收到用户名或密码。
- 你选择的代理服务器可以看到经它转发的流量。这是代理服务器自己能看到的内容，不是 SampleProxy 在收集。

删除扩展后，它不再控制 Chrome 的代理设置。保存在此浏览器配置中的扩展本地数据会随该配置的扩展数据一起消失。

问题或隐私相关请求：请在 <https://github.com/mengfei0053/SampleProxy/issues> 提交 issue。
