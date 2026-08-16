#!/usr/bin/env bash
#
# 限制本服務對外埠只接受來自 reverse proxy 的連線。於「服務主機」以 root 執行。
#
# 為何用 iptables DOCKER-USER：Docker 發佈埠(ports)會自行插入 iptables 規則、繞過
# ufw/firewalld，一般防火牆規則對它無效。Docker 保留 DOCKER-USER chain 供管理者插入
# 「先於」Docker 規則生效的自訂規則。用 conntrack --ctdir ORIGINAL 只比對原始方向，
# 避免把回程封包也擋掉而斷線。IPv6：因 proxy 為 IPv4，直接擋掉所有 v6 到該埠。
#
# 用法：
#   sudo ./scripts/firewall.sh                     # 套用限制
#   sudo ./scripts/firewall.sh remove              # 移除限制
#   PROXY_IP=1.2.3.4 PORT=9000 sudo ./scripts/firewall.sh
#
set -uo pipefail

PROXY_IP="${PROXY_IP:-23.146.248.8}"
PORT="${PORT:-9000}"
ACTION="${1:-apply}"
IPT=/usr/sbin/iptables
IP6T=/usr/sbin/ip6tables

v4=(DOCKER-USER -p tcp -m conntrack --ctorigdstport "$PORT" --ctdir ORIGINAL ! -s "$PROXY_IP" -j DROP)
v6=(DOCKER-USER -p tcp -m conntrack --ctorigdstport "$PORT" --ctdir ORIGINAL -j DROP)

if "$IPT" -nL DOCKER-USER >/dev/null 2>&1; then
  "$IPT" -D "${v4[@]}" 2>/dev/null || true            # 先清掉舊的同規則避免重複
  [[ "$ACTION" == remove ]] || "$IPT" -I "${v4[@]}"
else
  echo "警告：iptables 沒有 DOCKER-USER chain（Docker 未啟動？）"
fi

if "$IP6T" -nL DOCKER-USER >/dev/null 2>&1; then
  "$IP6T" -D "${v6[@]}" 2>/dev/null || true
  [[ "$ACTION" == remove ]] || "$IP6T" -I "${v6[@]}"
fi

if [[ "$ACTION" == remove ]]; then
  echo "已移除對 :$PORT 的來源限制。"
else
  echo "已套用：對外埠 :$PORT 僅允許 IPv4 來源 $PROXY_IP（其餘 DROP）；IPv6 全擋該埠。"
fi
echo "驗證： $IPT -nL DOCKER-USER -v --line-numbers"
echo "持久化(Debian/Ubuntu)： apt-get install -y iptables-persistent && netfilter-persistent save"
