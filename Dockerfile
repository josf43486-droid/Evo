FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip chromium chromium-driver ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium \
    CHROMEDRIVER_PATH=/usr/bin/chromedriver \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY requirements.txt ./
RUN python3 -m pip install --break-system-packages --upgrade pip \
    && python3 -m pip install --break-system-packages -r requirements.txt

RUN which chromium \
    && which chromedriver \
    && chromium --version \
    && chromedriver --version \
    && python3 - <<'PY'
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

options = Options()
options.binary_location = os.environ["CHROME_BIN"]
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
driver = webdriver.Chrome(service=Service(os.environ["CHROMEDRIVER_PATH"]), options=options)
try:
    driver.get("data:text/html,<title>selenium-ok</title><h1>OK</h1>")
    assert driver.title == "selenium-ok", driver.title
    print("SELENIUM_HEADLESS_TEST=PASS")
finally:
    driver.quit()
PY

COPY . .
RUN npm run build

ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
