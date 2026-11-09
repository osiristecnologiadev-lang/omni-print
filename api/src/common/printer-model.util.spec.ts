import { formatPrinterModel, identifyPrinter } from './printer-model.util';

const shown = (src: Parameters<typeof identifyPrinter>[0]) => {
  const id = identifyPrinter(src);
  return formatPrinterModel(id.manufacturer, id.model);
};

describe('identifyPrinter', () => {
  // Real values from production devices (2026-11-09).
  it('uses hrDeviceDescr when the agent sends it', () => {
    expect(shown({ model: 'HP LaserJet MFP M426dw', sysDescr: 'HP ETHERNET MULTI-ENVIRONMENT', printerName: 'HPBFEAB2' })).toBe(
      'HP LaserJet MFP M426dw',
    );
    expect(shown({ model: 'Brother HL-L5100DN series', sysDescr: 'Brother NC-8900h, Firmware Ver.ZP' })).toBe('Brother HL-L5100DN');
    expect(shown({ model: 'ECOSYS M3655idn', sysDescr: 'KYOCERA Document Solutions Printing System' })).toBe(
      'Kyocera ECOSYS M3655idn',
    );
  });

  it('takes the manufacturer from sysObjectID first', () => {
    expect(identifyPrinter({ model: 'Printer', sysObjectId: '1.3.6.1.4.1.2001.1.1.1.1' }).manufacturer).toBe('OKI');
  });

  it('reads the model out of sysDescr when only that is there', () => {
    expect(shown({ sysDescr: 'RICOH P 311 V2.15 / RICOH Network Printer C model', printerName: 'RICOH P 311 (c63daf)' })).toBe(
      'Ricoh P 311',
    );
    expect(shown({ sysDescr: 'KONICA MINOLTA bizhub C224', deviceName: '10.98.201.45' })).toBe('Konica Minolta bizhub C224');
    expect(shown({ sysDescr: 'HP ETHERNET MULTI-ENVIRONMENT,SN:BRBSK9K7FX,FN:4M8067W,PID:HP LaserJet MFP M426dw' })).toBe(
      'HP LaserJet MFP M426dw',
    );
  });

  it('falls back to a name that looks like a model', () => {
    expect(shown({ printerName: 'ECOSYS MA5500ifx', sysDescr: 'KYOCERA Document Solutions Printing System' })).toBe(
      'Kyocera ECOSYS MA5500ifx',
    );
    expect(shown({ printerName: 'WF-C5790 Series', sysDescr: 'EPSON Built-in 11b/g/n & 10/100/1000 Print Server' })).toBe(
      'Epson WF-C5790',
    );
    expect(shown({ printerName: 'OKI-ES5112-D14958', deviceName: 'SEDE.BIOMOL.A2', sysDescr: 'OKI OkiLAN 9400g Rev.00.53' })).toBe(
      'OKI ES5112',
    );
    expect(shown({ deviceName: 'RICOH SP 377DNwX (f42ddf)' })).toBe('Ricoh SP 377DNwX');
  });

  it('gives only the brand when nothing names the model', () => {
    expect(shown({ printerName: 'HPBFEAB2', sysDescr: 'HP ETHERNET MULTI-ENVIRONMENT' })).toBe('HP');
    expect(shown({ printerName: 'BRN94DDF85031D3', sysDescr: 'Brother NC-9600h, Firmware Ver.1.40' })).toBe('Brother');
    expect(shown({ deviceName: 'IMP_TERR_NTO_PROT_02' })).toBeNull();
    expect(shown({ deviceName: '192.168.111.155' })).toBeNull();
  });
});

describe('identifyPrinter - real edge cases', () => {
  it('reads models written before a semicolon in sysDescr', () => {
    expect(shown({ printerName: 'SEC842519AAFE3C', sysDescr: 'Samsung M4080FX; V11.01.03.04_02-27-2017' })).toBe('Samsung M4080FX');
    expect(shown({ printerName: 'HP7EBA75', sysDescr: 'HP Laser MFP 432fdn; V4.00.01.33fOCT-12-2023' })).toBe('HP Laser MFP 432fdn');
  });

  it('does not read a model out of the middle of a hostname', () => {
    expect(shown({ printerName: 'MFPBAC011', sysDescr: 'OKI OkiLAN 7400g Rev.01.00' })).toBe('OKI');
  });

  it('handles Epson WF-M and Zebra', () => {
    expect(shown({ printerName: 'WF-M5899 Series', sysDescr: 'EPSON Built-in 11b/g/n' })).toBe('Epson WF-M5899');
    expect(shown({ printerName: 'ETIQUETA', sysDescr: 'Zebra Technologies ZD230-203dpi / internal wired' })).toBe('Zebra ZD230');
    expect(shown({ printerName: 'ETIQUETA', sysDescr: 'ZebraNet PrintServer' })).toBe('Zebra');
  });

  it('takes the brand from a default hostname', () => {
    expect(shown({ printerName: 'HPE04362' })).toBe('HP');
    expect(shown({ printerName: 'SEC8425191D4F11' })).toBe('Samsung');
  });
});
