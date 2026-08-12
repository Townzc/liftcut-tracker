# 阿里云国内节点部署与备案复查

此配置会在同一台阿里云上海轻量服务器上运行应用容器和 Caddy 反向代理。应用端口 `3000` 不对公网开放；Caddy 只暴露 `80`、`443`，并在域名解析切换后自动申请和续期 HTTPS 证书。

> 当前国内 Docker Hub 网络不稳定时，优先使用下方的「原生 Node.js + Nginx」方案。它不依赖 Docker Hub，适合此服务器的单站点部署。

## 原生 Node.js + Nginx（推荐）

安装 Node.js 24 与 Nginx：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo apt-get install -y nodejs
```

构建独立运行包并安装 systemd 服务：

```bash
cd /opt/liftcut-tracker
npm ci
NODE_OPTIONS=--max-old-space-size=1536 npm run build
cp -a public .next/standalone/public
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/static
sudo cp deploy/liftcut-tracker.service /etc/systemd/system/liftcut-tracker.service
sudo systemctl daemon-reload
sudo systemctl enable --now liftcut-tracker
```

将 Nginx 配置为仅代理到本机应用端口：

```bash
sudo cp deploy/nginx/liftcut-tracker.conf /etc/nginx/sites-available/liftcut-tracker
sudo ln -s /etc/nginx/sites-available/liftcut-tracker /etc/nginx/sites-enabled/liftcut-tracker
sudo unlink /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
curl -I http://127.0.0.1:3000/
```

确认 DNS 已指向本机、阿里云防火墙已放行 TCP `80` 和 `443` 后，为两个域名签发证书：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d liftcuttracker.com -d www.liftcuttracker.com
```

## 1. 服务器准备

在服务器上以有 `sudo` 权限的用户执行：

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

重新登录 SSH，使 `docker` 组生效。阿里云轻量应用服务器防火墙和服务器本机防火墙都必须允许 TCP `80`、`443`；不应对公网开放 `3000`。

## 2. 上传代码和填写环境变量

将本项目放在服务器，例如 `/opt/liftcut-tracker`，然后：

```bash
cd /opt/liftcut-tracker
cp deploy/.env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

填写与 Vercel 当前生产环境一致的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`，以及实际使用的 AI 服务端变量。`NEXT_PUBLIC_*` 会在镜像构建时写入浏览器包，因此更新这些值后必须带 `--build` 重新部署；其他服务端变量只在运行时读取。

## 3. 预上线验证

在 DNS 尚未切换前，先启动应用容器并确认健康检查：

```bash
docker compose --env-file .env.production up -d --build app
docker compose ps
docker compose logs --tail=100 app
curl -I http://127.0.0.1:3000/
```

应用容器健康后，再启动 Caddy：

```bash
docker compose --env-file .env.production up -d
docker compose ps
```

此时 Caddy 在域名尚未解析到本机前可能会记录证书申请失败；切换 DNS 后会自动重试。

## 4. 切换 DNS

在域名 DNS 服务商处把以下记录改为阿里云上海服务器公网 IP：

| 主机记录 | 类型 | 记录值 |
| --- | --- | --- |
| `@` | `A` | 服务器的公网 IP |
| `www` | `A` | 服务器的公网 IP |

删除或替换目前指向 Vercel 的 `www` CNAME，避免同一主机记录冲突。先将 TTL 调低至 600 秒；DNS 生效后检查：

```bash
curl -I https://liftcuttracker.com/
curl -I https://www.liftcuttracker.com/
docker compose logs --tail=100 caddy
```

请求头中不应再出现 `Server: Vercel`，而应成功返回站点的重定向或页面响应。确认正常后再保留低 TTL 一段时间，随后可调回正常值。

## 5. 备案复查

登录收到通知的阿里云备案账号，在「我的备案」的该核查事项中点击「申请复查」。提交前保存以下证据：DNS 记录截图、阿里云服务器公网 IP 与地域截图、域名可访问截图、HTTPS 正常截图。备案核查期间保持域名持续解析到这台阿里云中国内地服务器并有正常访问。

## 日常更新与回滚

```bash
cd /opt/liftcut-tracker
git pull --ff-only
docker compose --env-file .env.production up -d --build
docker image prune -f
```

回滚时检出上一已验证的 Git 提交后再次运行相同的 `docker compose ... up -d --build`。不要删除 `caddy_data` 卷，否则会丢失证书状态并可能触发重复签发限制。
