import {createHash,timingSafeEqual} from "node:crypto";
const md5 = s => createHash("md5").update(s,"utf8").digest("hex");
const json = (data,status=200,headers={}) => new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...headers}});
const igual = (a,b) => {
  if(typeof a!=="string" || typeof b!=="string" || !/^[a-f0-9]{32}$/i.test(a) || !/^[a-f0-9]{32}$/i.test(b))return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase()),Buffer.from(b.toLowerCase()));
};
async function base(env,datos){
  const response=await fetch(env.TIENDA_SCRIPT_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({...datos,secret:env.TIENDA_SECRET}),signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error("No pudimos conectar con el registro de pedidos.");
  const data=await response.json();
  if(!data.ok)throw Error(data.error||"No pudimos registrar el pedido.");
  return data;
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const origen=request.headers.get("Origin");
    const permitidos=String(env.ALLOWED_ORIGINS||"").split(",").map(s=>s.trim()).filter(Boolean);
    const cors=permitidos.includes(origen)?{"Access-Control-Allow-Origin":origen,"Vary":"Origin","Access-Control-Allow-Methods":"POST, GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}:{};
    try{
      if(url.pathname==="/vpos/confirm" && request.method==="POST"){
        const {operation:o}=await request.json();
        if(!o || !/^\d{1,16}$/.test(String(o.shop_process_id)) ||
           typeof o.amount!=="string" || !/^\d+\.\d{2}$/.test(o.amount) || o.currency!=="PYG")return json({status:"error"},400);
        const esperado=md5(env.VPOS_PRIVATE_KEY+String(o.shop_process_id)+"confirm"+o.amount+o.currency);
        if(!igual(o.token,esperado))return json({status:"error"},401);
        await base(env,{accion:"confirmar",id:String(o.shop_process_id),total:Number(o.amount),
          aprobado:o.response==="S" && String(o.response_code)==="00",ticket:String(o.ticket_number||o.authorization_number||"")});
        return json({status:"success"});
      }
      if(!permitidos.includes(origen))return json({ok:false,error:"Origen no autorizado."},403);
      if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
      if(url.pathname==="/catalogo" && request.method==="GET")return json(await base(env,{accion:"catalogo"}),200,cors);
      if(request.method!=="POST")return json({ok:false,error:"Ruta no encontrada."},404,cors);
      const body=await request.json();
      if(url.pathname==="/estado"){
        if(!/^\d{1,16}$/.test(String(body.id)) || typeof body.clave!=="string" || body.clave.length>100)return json({ok:false,error:"Consulta inválida."},400,cors);
        return json(await base(env,{accion:"estado",id:String(body.id),clave:body.clave}),200,cors);
      }
      if(url.pathname!=="/checkout")return json({ok:false,error:"Ruta no encontrada."},404,cors);
      const pedido=await base(env,{...body,accion:"crear"});
      if(pedido.estado==="PAGADO" || pedido.processId)return json(pedido,200,cors);
      const amount=Number(pedido.total).toFixed(2),currency="PYG";
      const retorno=new URL(env.STORE_URL);
      retorno.searchParams.set("pedido",pedido.id);retorno.searchParams.set("clave",pedido.clave);
      const bancard=await fetch("https://vpos.infonet.com.py/vpos/api/0.3/single_buy",{
        method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(25000),
        body:JSON.stringify({public_key:env.VPOS_PUBLIC_KEY,operation:{
          token:md5(env.VPOS_PRIVATE_KEY+pedido.id+amount+currency),
          shop_process_id:Number(pedido.id),amount,currency,description:"Tienda Arkhe · "+pedido.id,
          return_url:retorno.href,cancel_url:retorno.href
        }})
      });
      const respuesta=await bancard.json();
      if(!bancard.ok || respuesta.status!=="success" || !respuesta.process_id){
        // Se conserva la reserva hasta revisar el estado real del pedido.
        throw Error("Bancard no pudo abrir el pago. Consultanos con el pedido "+pedido.id+".");
      }
      pedido.processId=String(respuesta.process_id);
      await base(env,{accion:"proceso",id:pedido.id,clave:pedido.clave,processId:pedido.processId});
      return json(pedido,200,cors);
    }catch(error){
      console.error("Error tienda:",error.message);
      return json({ok:false,error:url.pathname==="/vpos/confirm"?"No se pudo registrar la confirmación.":error.message},url.pathname==="/vpos/confirm"?500:400,cors);
    }
  }
};
