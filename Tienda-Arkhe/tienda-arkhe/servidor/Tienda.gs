// Crear un proyecto Apps Script NUEVO para la tienda y pegar este archivo.
// Configurar TIENDA_SECRET en Propiedades del script con una clave larga aleatoria.
const TIENDA_PRODUCTOS = [
  {id:"noches-blancas",nombre:"Noches blancas",precio:760000,stock:3},
  {id:"piedra-bruta",nombre:"Pulir la piedra bruta",precio:200000,stock:3},
  {id:"zaratustra",nombre:"Así habló Zaratustra",precio:50000,stock:5},
  {id:"caballero",nombre:"Bernardino Caballero. El gran iniciado",precio:50000,stock:5},
  {id:"anticristo",nombre:"El Anticristo",precio:50000,stock:5},
  {id:"tragedia",nombre:"El origen de la tragedia",precio:50000,stock:5},
  {id:"bien-mal",nombre:"Más allá del bien y del mal",precio:50000,stock:5}
];
const COLUMNAS_TIENDA = ["Pedido","Creación","Nombre","Correo","WhatsApp","Entrega","Productos JSON","Total","Estado pago","Clave consulta","Intento","Ticket Bancard","Fecha pago","Estado entrega","Correo enviado","Process ID"];

function configurarTienda() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("TIENDA_SECRET") || props.getProperty("TIENDA_SECRET").length < 32) {
    throw new Error("Configurá TIENDA_SECRET con al menos 32 caracteres.");
  }
  let id = props.getProperty("TIENDA_PLANILLA");
  if (!id) {
    const libro = SpreadsheetApp.create("Tienda Arkhé — Pedidos");
    id = libro.getId();
    props.setProperty("TIENDA_PLANILLA", id);
    const hoja = libro.getSheets()[0];
    hoja.setName("PEDIDOS");
    hoja.getRange(1,1,1,COLUMNAS_TIENDA.length).setValues([COLUMNAS_TIENDA]);
    hoja.setFrozenRows(1);
    hoja.getRange("I:I").setNumberFormat("@");
    hoja.getRange("L:L").setNumberFormat("@");
    hoja.getRange("J:K").setNumberFormat("@");
  }
  if (!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==="enviarRecibosTienda")) {
    ScriptApp.newTrigger("enviarRecibosTienda").timeBased().everyMinutes(5).create();
  }
  MailApp.getRemainingDailyQuota();
  console.log("Planilla de pedidos: https://docs.google.com/spreadsheets/d/"+id+"/edit");
}
function libroTienda_() {
  const id=PropertiesService.getScriptProperties().getProperty("TIENDA_PLANILLA");
  if(!id)throw new Error("Falta ejecutar configurarTienda.");
  return SpreadsheetApp.openById(id).getSheetByName("PEDIDOS");
}
function filasTienda_(hoja) {
  return hoja.getLastRow()<2?[]:hoja.getRange(2,1,hoja.getLastRow()-1,COLUMNAS_TIENDA.length).getValues();
}
function jsonTienda_(objeto){return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);}
function doPost(e) {
  const lock=LockService.getScriptLock();
  let adquirido=false;
  try {
    const datos=JSON.parse(e.postData.contents);
    const secret=PropertiesService.getScriptProperties().getProperty("TIENDA_SECRET");
    if(!secret || datos.secret!==secret)return jsonTienda_({ok:false,error:"No autorizado."});
    if(!lock.tryLock(20000))throw new Error("La tienda está ocupada. Volvé a intentar.");
    adquirido=true;
    const hoja=libroTienda_(), filas=filasTienda_(hoja);
    switch(datos.accion) {
      case "catalogo": return jsonTienda_({ok:true,productos:disponiblesTienda_(filas)});
      case "crear": return jsonTienda_(crearPedidoTienda_(hoja,filas,datos));
      case "estado": {
        const fila=filas.find(f=>f[0]===datos.id && f[9]===datos.clave);
        if(!fila)throw new Error("Pedido no encontrado.");
        return jsonTienda_(pedidoPublicoTienda_(fila));
      }
      case "proceso": {
        const i=filas.findIndex(f=>f[0]===datos.id && f[9]===datos.clave);
        if(i<0)throw new Error("Pedido no encontrado.");
        if(!/^[A-Za-z0-9_-]{8,200}$/.test(String(datos.processId)))throw new Error("Proceso inválido.");
        hoja.getRange(i+2,16).setValue(datos.processId);
        return jsonTienda_({ok:true});
      }
      case "confirmar": {
        const i=filas.findIndex(f=>String(f[0])===String(datos.id));
        if(i<0)throw new Error("Pedido no encontrado.");
        const fila=filas[i];
        if(!Number.isFinite(Number(datos.total)) || Number(datos.total)!==Number(fila[7]))throw new Error("El monto no coincide.");
        if(fila[8]==="PAGADO")return jsonTienda_({ok:true,duplicado:true});
        if(datos.aprobado===true){
          hoja.getRange(i+2,9).setValue("PAGADO");
          hoja.getRange(i+2,12).setNumberFormat("@").setValue(String(datos.ticket||""));
          hoja.getRange(i+2,13).setValue(new Date());
        }else{
          hoja.getRange(i+2,9).setValue("RECHAZADO");
        }
        SpreadsheetApp.flush();
        return jsonTienda_({ok:true});
      }
      default:throw new Error("Acción inválida.");
    }
  }catch(error){return jsonTienda_({ok:false,error:error.message});}
  finally{if(adquirido)lock.releaseLock();}
}
function disponiblesTienda_(filas){
  const unidades={};
  for(const fila of filas){
    if(fila[8]==="RECHAZADO" || fila[8]==="ANULADO")continue;
    for(const item of JSON.parse(fila[6]))unidades[item.id]=(unidades[item.id]||0)+item.cantidad;
  }
  return TIENDA_PRODUCTOS.map(p=>({id:p.id,precio:p.precio,disponible:Math.max(0,p.stock-(unidades[p.id]||0))}));
}
function crearPedidoTienda_(hoja,filas,d){
  if(!/^[a-f0-9-]{36}$/i.test(String(d.intento)))throw new Error("Identificador de compra inválido.");
  const previo=filas.find(f=>f[10]===d.intento);
  if(previo){
    if(previo[8]==="RECHAZADO" || previo[8]==="ANULADO")throw new Error("El pedido se cerró. Actualizá tu selección para iniciar otro.");
    return pedidoPublicoTienda_(previo);
  }
  if(typeof d.nombre!=="string" || !d.nombre.trim() || d.nombre.length>100 ||
     typeof d.correo!=="string" || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(d.correo) || d.correo.length>150 ||
     typeof d.telefono!=="string" || !/^[+()\d .-]{6,30}$/.test(d.telefono) ||
     !["Retiro","Delivery"].includes(d.entrega))throw new Error("Revisá los datos de contacto y la entrega.");
  if(!Array.isArray(d.items) || d.items.length<1 || d.items.length>7)throw new Error("Selección inválida.");
  const stock=disponiblesTienda_(filas), vistos=new Set();
  const items=d.items.map(item=>{
    const p=TIENDA_PRODUCTOS.find(p=>p.id===item.id);
    if(!p || vistos.has(p.id) || !Number.isInteger(item.cantidad) || item.cantidad<1 ||
       item.cantidad>stock.find(s=>s.id===p.id).disponible)throw new Error("Stock insuficiente. Actualizá tu selección.");
    vistos.add(p.id);
    return {id:p.id,nombre:p.nombre,cantidad:item.cantidad,precio:p.precio};
  });
  let id;
  do{id=String(Date.now())+String(Math.floor(Math.random()*900)+100);}while(filas.some(f=>String(f[0])===id));
  const clave=Utilities.getUuid()+Utilities.getUuid();
  const total=items.reduce((n,p)=>n+p.cantidad*p.precio,0);
  // Datos de contacto en texto literal, para impedir fórmulas en las celdas.
  const literal=valor=>"'"+valor.trim();
  hoja.appendRow([id,new Date(),literal(d.nombre),literal(d.correo),literal(d.telefono),d.entrega,
    JSON.stringify(items),total,"PENDIENTE",clave,d.intento,"","","POR COORDINAR","",""]);
  SpreadsheetApp.flush();
  return {ok:true,id,clave,total,items,entrega:d.entrega,estado:"PENDIENTE",processId:""};
}
function pedidoPublicoTienda_(fila){
  return {ok:true,id:String(fila[0]),clave:String(fila[9]),total:Number(fila[7]),items:JSON.parse(fila[6]),entrega:fila[5],estado:fila[8],processId:String(fila[15]||"")};
}
function enviarRecibosTienda(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return;
  try{
    const hoja=libroTienda_(), filas=filasTienda_(hoja);
    for(let i=0;i<filas.length;i++){
      const f=filas[i];
      if(f[8]!=="PAGADO" || f[14])continue;
      if(MailApp.getRemainingDailyQuota()<1)break;
      const items=JSON.parse(f[6]);
      const detalle=items.map(p=>p.cantidad+" × "+p.nombre+" — Gs. "+(p.precio*p.cantidad).toLocaleString("es-PY")).join("\n");
      const mensaje="Hola, "+f[2]+".\n\nTu compra en Tienda Arkhé fue confirmada.\nPedido: "+f[0]+"\n\n"+detalle+
        "\n\nTotal de productos: Gs. "+Number(f[7]).toLocaleString("es-PY")+"\nModalidad: "+f[5]+
        "\n\nCoordiná tu entrega por WhatsApp: https://wa.me/595994430466?text="+
        encodeURIComponent("Hola, quiero coordinar mi pedido "+f[0]+". "+detalle+". Modalidad: "+f[5])+
        "\n\nGracias por elegir Arkhé en Escena.";
      hoja.getRange(i+2,15).setValue("ENVIANDO");SpreadsheetApp.flush();
      try{
        MailApp.sendEmail({to:f[3],subject:"Compra confirmada — Tienda Arkhé · "+f[0],body:mensaje,name:"Arkhé en Escena"});
        hoja.getRange(i+2,15).setValue("ENVIADO "+Utilities.formatDate(new Date(),"America/Asuncion","dd/MM/yyyy HH:mm:ss"));
      }catch(error){hoja.getRange(i+2,15).setValue("REVISAR ENVÍO");console.error("Pedido "+f[0]+": "+error.message);}
      SpreadsheetApp.flush();
    }
  }finally{lock.releaseLock();}
}
