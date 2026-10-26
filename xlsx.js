'use strict';
var zlib = require('zlib');
// 最小 XLSX 写入器（inlineStr，无需第三方库）
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function colName(n){ var s=''; n++; while(n>0){ var m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
function sheetXml(rows){
  var body = rows.map(function(row, ri){
    var cells = row.map(function(v, ci){
      var ref = colName(ci)+(ri+1);
      if(v===null||v===undefined||v==='') return '<c r="'+ref+'"/>';
      if(typeof v==='number') return '<c r="'+ref+'" t="n"><v>'+v+'</v></c>';
      return '<c r="'+ref+'" t="inlineStr"><is><t>'+esc(v)+'</t></is></c>';
    }).join('');
    return '<row r="'+(ri+1)+'">'+cells+'</row>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+body+'</sheetData></worksheet>';
}
function zip(files){
  var locals=[], centrals=[], offset=0;
  files.forEach(function(f){
    var nameBuf=Buffer.from(f.name,'utf8');
    var data=Buffer.from(f.data,'utf8');
    var comp=zlib.deflateRawSync(data);
    var crc=zlib.crc32?zlib.crc32(data):crc32(data);
    var lh=Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0x0800,6);
    lh.writeUInt16LE(8,8); lh.writeUInt16LE(0,10); lh.writeUInt16LE(0,12);
    lh.writeUInt32LE(crc,14); lh.writeUInt32LE(comp.length,18); lh.writeUInt32LE(data.length,22);
    lh.writeUInt16LE(nameBuf.length,26); lh.writeUInt16LE(0,28);
    locals.push(lh, nameBuf, comp);
    var ch=Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6); ch.writeUInt16LE(0x0800,8);
    ch.writeUInt16LE(8,10); ch.writeUInt16LE(0,12); ch.writeUInt16LE(0,14);
    ch.writeUInt32LE(crc,16); ch.writeUInt32LE(comp.length,20); ch.writeUInt32LE(data.length,24);
    ch.writeUInt16LE(nameBuf.length,28); ch.writeUInt16LE(0,30); ch.writeUInt16LE(0,32); ch.writeUInt16LE(0,34);
    ch.writeUInt16LE(0,36); ch.writeUInt32LE(0,38); ch.writeUInt32LE(offset,42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  });
  var cd = Buffer.concat(centrals);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(0,4); end.writeUInt16LE(0,6);
  end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(cd.length,12); end.writeUInt32LE(offset,16); end.writeUInt16LE(0,20);
  return Buffer.concat([Buffer.concat(locals), cd, end]);
}
function crc32(buf){ var c, crc=0xFFFFFFFF; for(var i=0;i<buf.length;i++){ c=(crc^buf[i])&0xFF; for(var k=0;k<8;k++){ c = c&1 ? (0xEDB88320^(c>>>1)) : (c>>>1); } crc=(crc>>>8)^c; } return (crc^0xFFFFFFFF)>>>0; }
function buildXlsx(sheetName, rows){
  var files=[
    {name:'[Content_Types].xml', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},
    {name:'_rels/.rels', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:'xl/workbook.xml', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+esc(sheetName)+'" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:'xl/_rels/workbook.xml.rels', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'},
    {name:'xl/worksheets/sheet1.xml', data:sheetXml(rows)}
  ];
  return zip(files);
}
module.exports = { buildXlsx: buildXlsx };
