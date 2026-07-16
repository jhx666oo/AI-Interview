@echo off
chcp 65001 >nul
echo === 飞书多维表格 → AI Interview 需求同步 ===
echo.

:: 1. 用 lark-cli 拉取年度招聘需求表数据，输出为 JSON
echo [1/3] 从飞书获取需求数据...
lark-cli base +record-list ^
  --base-token NVh9bDiNRaF0ZysxjeLc5ID2n9c ^
  --table-id tblEiMBFXcvSspQd ^
  --page-size 500 ^
  --format json > feishu_requisitions_raw.json

if %errorlevel% neq 0 (
  echo ❌ 获取飞书数据失败
  exit /b 1
)

:: 2. 转换数据并推送到 Worker API
echo [2/3] 同步到本地系统...
echo   请先确保 Worker 已部署且 API 可访问
echo   运行: lark-cli 数据 → Worker API 推送

:: 3. 完成提示
echo [3/3] 完成
echo.
echo ✅ 数据已保存到 feishu_requisitions_raw.json
echo.
echo 你也可以直接登录系统，在「需求管理」页面点击「同步飞书」按钮
echo 后端 Worker 会自动拉取飞书数据并写入数据库。
