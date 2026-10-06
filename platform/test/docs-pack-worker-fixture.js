// Local-only entry; never deployed. Uses real public docs and actual HTMLRewriter.
import {createDocsPack,htmlText} from '../src/docs-pack.js';
export default {async fetch(request){
 try{
  const body=await request.json();
  if(body.fixture_html!==undefined)return Response.json(await htmlText(body.fixture_html));
  const handler=createDocsPack(),input=handler.input.parse(body),output=await handler.run(input);
  if(!handler.output.safeParse(output).success||!handler.success(output))throw new Error('contract_failed');
  return Response.json(output);
 }catch(e){return Response.json({error:e.message},{status:422});}
}};
