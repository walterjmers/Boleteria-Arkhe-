import {productos} from "./productos.js";
import {API_URL} from "./config.js";
const $ = id => document.getElementById(id);
const dinero = n => "Gs. " + Number(n).toLocaleString("es-PY");
const texto = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const limites = new Map(productos.map(p => [p.id,p.stock]));
let seleccion = {};
let filtro = "Todos";
let pedido;
let intento = crypto.randomUUID();
let revision = 0;
let toastTimer;
function guardar(clave,valor){try{localStorage.setItem(clave,JSON.stringify(valor));}catch{}}
function leer(clave){try{return JSON.parse(localStorage.getItem(clave));}catch{return null;}}
function mostrar(id){if(!$(id).open)$(id).showModal();}
function cerrar(id){$(id).close();}
function avisar(mensaje){$("aviso").textContent=mensaje;$("aviso").hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("aviso").hidden=true,3500);}
async function api(ruta,datos){
  if(!API_URL) throw Error("Estamos preparando el pago online. Consultá por WhatsApp para comprar.");
  const response=await fetch(API_URL.replace(/\/$/,"")+ruta,datos?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(datos)}:{cache:"no-store"});
  const result=await response.json();
  if(!response.ok || !result.ok)throw Error(result.error||"No pudimos completar la consulta.");
  return result;
}
function total(){return productos.reduce((n,p)=>n+p.precio*(seleccion[p.id]||0),0);}
function guardarSeleccion(){guardar("arkhe.tienda.carrito",seleccion);intento=crypto.randomUUID();dibujarCarrito();}
function agregar(id){
  const p=productos.find(p=>p.id===id);
  if((seleccion[id]||0)>=limites.get(id)){avisar("No hay más unidades disponibles de este producto.");return;}
  seleccion[id]=(seleccion[id]||0)+1;guardarSeleccion();avisar(p.nombre+" se agregó a tu selección.");
}
function dibujarProductos(){
  $("productos").innerHTML=productos.filter(p=>filtro==="Todos"||p.categoria===filtro).map(p=>`<article class="tarjeta ${p.categoria==="Objetos"?"objeto":""}">
    <button class="foto-producto" data-detalle="${p.id}" aria-label="Ver ${texto(p.nombre)}"><img src="assets/${p.id}.jpg" alt="${texto(p.nombre)}" loading="lazy"></button>
    <h3>${texto(p.nombre)}</h3><p class="autor">${texto(p.detalle)}</p>
    <div class="pie-producto"><strong>${dinero(p.precio)}</strong><button class="agregar" data-agregar="${p.id}" ${!limites.get(p.id)?"disabled":""}>${limites.get(p.id)?"Agregar":"Agotado"}</button></div>
    <p class="stock">${limites.get(p.id)} ${limites.get(p.id)===1?"unidad disponible":"unidades disponibles"}</p></article>`).join("");
}
function dibujarCarrito(){
  $("cuenta").textContent=Object.values(seleccion).reduce((a,b)=>a+b,0);
  $("lineasCarrito").innerHTML=productos.filter(p=>seleccion[p.id]).map(p=>`<div class="linea"><img src="assets/${p.id}.jpg" alt=""><div><h3>${texto(p.nombre)}</h3><p>${dinero(p.precio)} por unidad</p><div class="cantidad"><button data-cantidad="${p.id}" data-cambio="-1" aria-label="Quitar una unidad de ${texto(p.nombre)}">−</button><span>${seleccion[p.id]}</span><button data-cantidad="${p.id}" data-cambio="1" aria-label="Agregar una unidad de ${texto(p.nombre)}">+</button></div><button class="quitar" data-quitar="${p.id}">Quitar</button></div><strong>${dinero(p.precio*seleccion[p.id])}</strong></div>`).join("")||"<p>Tu selección está vacía. Explorá la colección para encontrar tu próxima lectura o pieza.</p>";
  $("totalCarrito").textContent=dinero(total());$("totalCompra").textContent=dinero(total());$("continuar").disabled=!total();
}
async function catalogo(){
  if(!API_URL){$("estadoCatalogo").textContent="Pago online en preparación. Podés consultar por WhatsApp.";return;}
  try{
    const datos=await api("/catalogo");
    for(const p of datos.productos){if(limites.has(p.id))limites.set(p.id,p.disponible);}
    $("estadoCatalogo").textContent="";
    dibujarProductos();
  }catch{$("estadoCatalogo").textContent="Consultá disponibilidad por WhatsApp si no podés iniciar el pago.";}
}
document.addEventListener("click",event=>{
  const boton=event.target.closest("button");
  if(!boton)return;
  if(boton.dataset.cerrar)cerrar(boton.dataset.cerrar);
  if(boton.dataset.agregar)agregar(boton.dataset.agregar);
  if(boton.dataset.detalle){
    const p=productos.find(p=>p.id===boton.dataset.detalle);
    $("detalleContenido").innerHTML=`<img src="assets/${p.id}.jpg" alt="${texto(p.nombre)}"><div><p class="ceja">${p.categoria}</p><h2>${texto(p.nombre)}</h2><p>${texto(p.detalle)}</p>${p.frase?"<p><em>"+texto(p.frase)+"</em></p>":""}<p>${texto(p.descripcion)}</p><p><strong>${dinero(p.precio)}</strong></p><button class="boton" data-agregar="${p.id}">Agregar a mi selección</button></div>`;
    mostrar("detalle");
  }
  if(boton.dataset.filtro){
    filtro=boton.dataset.filtro;
    document.querySelectorAll("[data-filtro]").forEach(b=>b.setAttribute("aria-pressed",String(b===boton)));
    dibujarProductos();
  }
  if(boton.dataset.cantidad){
    const id=boton.dataset.cantidad,n=(seleccion[id]||0)+Number(boton.dataset.cambio);
    if(n>limites.get(id)){avisar("No hay más unidades disponibles.");return;}
    if(n<=0)delete seleccion[id];else seleccion[id]=n;
    guardarSeleccion();
  }
  if(boton.dataset.quitar){delete seleccion[boton.dataset.quitar];guardarSeleccion();}
});
$("abrirCarrito").onclick=()=>mostrar("carrito");
$("continuar").onclick=()=>{cerrar("carrito");mostrar("compra");};
$("formCompra").addEventListener("submit",async event=>{
  event.preventDefault();$("errorCompra").textContent="";$("pagar").disabled=true;$("pagar").textContent="Preparando tu pedido…";
  try{
    const cliente=Object.fromEntries(new FormData(event.target));
    const datos=await api("/checkout",{...cliente,items:Object.entries(seleccion).map(([id,cantidad])=>({id,cantidad})),intento});
    pedido={id:datos.id,clave:datos.clave,items:datos.items,entrega:cliente.entrega,total:datos.total,creado:Date.now(),processId:datos.processId||""};
    guardar("arkhe.tienda.pedido",pedido);
    cerrar("compra");
    if(datos.estado==="PAGADO"){compraExitosa();return;}
    abrirPago(pedido);
  }catch(error){$("errorCompra").textContent=error.message;catalogo();}
  finally{$("pagar").disabled=false;$("pagar").textContent="Pagar con Bancard";}
});
function abrirPago(datos){
  $("pedidoPago").textContent="Pedido "+datos.id+" · "+dinero(datos.total);
  $("estadoPago").textContent="Esperando la confirmación de Bancard.";
  $("bancard").replaceChildren();$("volverPedido").hidden=true;mostrar("pago");
  if(datos.processId && window.Bancard?.Checkout){
    try{Bancard.Checkout.createForm("bancard",datos.processId,{"button-background-color":"#17241e","button-text-color":"#ffffff"});}
    catch{$("estadoPago").textContent="No pudimos abrir el formulario. Consultá por WhatsApp con el número de pedido.";}
  }else{$("estadoPago").textContent="Estamos verificando el estado de tu pedido."; }
  vigilarPago(datos);
}
function compraExitosa(){
  revision++;
  ["pago","compra","carrito"].forEach(id=>{if($(id).open)cerrar(id);});
  $("resumenExito").textContent="Pedido "+pedido.id+" · "+dinero(pedido.total)+" · "+pedido.entrega;
  const articulos=pedido.items.map(p=>p.cantidad+" × "+p.nombre).join(", ");
  $("coordinar").href="https://wa.me/595994430466?text="+encodeURIComponent("Hola, Arkhé. Quiero coordinar la entrega de mi pedido "+pedido.id+". Productos: "+articulos+". Modalidad: "+pedido.entrega+". Total de productos: "+dinero(pedido.total)+".");
  seleccion={};guardarSeleccion();mostrar("exito");catalogo();
}
async function vigilarPago(datos){
  const actual=++revision;
  for(let i=0;i<90 && actual===revision;i++){
    try{
      const estado=await api("/estado",{id:datos.id,clave:datos.clave});
      if(actual!==revision)return;
      if(estado.estado==="PAGADO"){pedido=datos;compraExitosa();return;}
      if(estado.estado==="RECHAZADO"){
        $("estadoPago").textContent="Bancard informó que el pago fue rechazado. Consultá por WhatsApp si necesitás ayuda.";catalogo();return;
      }
    }catch{$("estadoPago").textContent="Estamos intentando verificar el pago. Si ya ves un cargo, conservá el comprobante y consultanos por WhatsApp.";}
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
  if(actual===revision){$("estadoPago").textContent="Todavía no recibimos la confirmación. Si ya ves un cargo, consultanos con tu número de pedido.";$("volverPedido").hidden=false;}
}
$("volverPedido").onclick=()=>{if(pedido)vigilarPago(pedido);};
const guardado=leer("arkhe.tienda.carrito");
if(guardado && typeof guardado==="object"){
  for(const p of productos)if(Number.isInteger(guardado[p.id]) && guardado[p.id]>0)seleccion[p.id]=Math.min(guardado[p.id],p.stock);
}
dibujarProductos();dibujarCarrito();catalogo();
const retorno=new URL(location.href).searchParams;
pedido=leer("arkhe.tienda.pedido");
if(retorno.get("pedido") && retorno.get("clave")){
  pedido={id:retorno.get("pedido"),clave:retorno.get("clave"),creado:Date.now()};
  guardar("arkhe.tienda.pedido",pedido);
  history.replaceState(null,"",location.pathname);
}
async function recuperarPedido(){
  if(!pedido || !API_URL || window.self!==window.top || Date.now()-pedido.creado>7*86400000)return;
  try{
    const estado=await api("/estado",{id:pedido.id,clave:pedido.clave});
    pedido={...pedido,...estado};guardar("arkhe.tienda.pedido",pedido);
    if(estado.estado==="PAGADO")compraExitosa();else abrirPago(pedido);
  }catch{avisar("Podés consultar el estado de tu pedido por WhatsApp.");}
}
recuperarPedido();
