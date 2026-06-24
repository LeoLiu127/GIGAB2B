import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import openpyxl

wb = openpyxl.load_workbook(r'D:\ziniao browser\BAT-US\Euro\PLANTER-de.xlsm', data_only=True, keep_vba=False)
ws = wb['Vorlage']
headers = {}
for cell in ws[1]:
    if cell.value is not None:
        headers[cell.column] = str(cell.value)
for col, name in sorted(headers.items()):
    print('Col %d: %s' % (col, name[:200]))
