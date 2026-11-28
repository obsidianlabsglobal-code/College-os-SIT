import {BoardScreen} from "./screen";
export default function BoardingScreen() {
  return <main className="panel stack" style={{margin:"1rem auto",maxWidth:"480px"}}><h1>Bus boarding screen</h1>
    <p>Only set up this screen when parked. Once connected, it changes automatically for the active trip.</p><BoardScreen/></main>;
}
