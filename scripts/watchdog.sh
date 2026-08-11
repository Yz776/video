#!/bin/bash
# Auto-restart watchdog for Next.js standalone server
LOG=/tmp/prod.log
PIDFILE=/tmp/server.pid
while true; do
  if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
    # Server still running, wait
    sleep 2
    continue
  fi
  echo "[$(date)] Starting server..." >> $LOG
  PORT=3000 NODE_ENV=production NODE_OPTIONS="--max-old-space-size=512" \
    node /home/z/my-project/.next/standalone/server.js >> $LOG 2>&1 &
  echo $! > $PIDFILE
  sleep 3
done
