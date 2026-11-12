import { beforeAll, describe, expect, it } from "vitest";
import { isTechJob } from "../src/extract/relevance.js";
import { createSkillExtractor, loadSkillDefinitions, type SkillExtractor } from "../src/extract/skills.js";

let extract: SkillExtractor;

beforeAll(async () => {
  extract = createSkillExtractor(await loadSkillDefinitions());
});

describe("catálogo skills.json", () => {
  it("es válido, sin duplicados y con un tamaño razonable", async () => {
    const defs = await loadSkillDefinitions();
    expect(defs.length).toBeGreaterThan(80);
  });
});

describe("extractor de skills: detección básica", () => {
  it("detecta alias sin importar mayúsculas", () => {
    expect(extract("We use TYPESCRIPT, nodejs and PostgreSQL / postgres.")).toEqual(
      expect.arrayContaining(["TypeScript", "Node.js", "PostgreSQL"]),
    );
  });

  it("no repite skills y devuelve la lista ordenada", () => {
    const result = extract("Docker docker DOCKER, Python, python");
    expect(result).toEqual(["Docker", "Python"]);
  });

  it("devuelve vacío para texto vacío o nulo", () => {
    expect(extract("")).toEqual([]);
    expect(extract(null)).toEqual([]);
    expect(extract(undefined)).toEqual([]);
  });

  it("acepta versiones pegadas: Python3, HTML5, Java17", () => {
    expect(extract("Python3 y HTML5; Java17")).toEqual(expect.arrayContaining(["Python", "HTML", "Java"]));
  });

  it("reconoce alias con espacios y variantes", () => {
    expect(extract("Experience with Amazon Web Services, Google Cloud and k8s")).toEqual(
      expect.arrayContaining(["AWS", "GCP", "Kubernetes"]),
    );
    expect(extract("Large  Language   Models and machine learning")).toEqual(
      expect.arrayContaining(["LLM", "Machine Learning"]),
    );
  });
});

describe("extractor de skills: falsos positivos clásicos", () => {
  it("Java no se confunde con JavaScript (y al revés)", () => {
    expect(extract("Strong JavaScript skills")).toEqual(["JavaScript"]);
    expect(extract("Java and Spring Boot")).toEqual(expect.arrayContaining(["Java", "Spring"]));
    expect(extract("Java and Spring Boot")).not.toContain("JavaScript");
  });

  it("SQL no se confunde con PostgreSQL, MySQL ni NoSQL", () => {
    expect(extract("PostgreSQL and MySQL experience")).not.toContain("SQL");
    expect(extract("NoSQL databases")).toEqual([]);
    expect(extract("Solid SQL knowledge")).toEqual(["SQL"]);
  });

  it("'Go' como palabra común no cuenta sin contexto técnico", () => {
    expect(extract("Own the go-to-market plan. Go beyond expectations. Let's go!")).toEqual([]);
  });

  it("'Go' cuenta cuando la oferta ya tiene skills técnicas fuertes", () => {
    expect(extract("Backend in Python, Go and Kubernetes")).toEqual(expect.arrayContaining(["Go", "Python", "Kubernetes"]));
    expect(extract("Experience with Golang")).toEqual(["Go"]);
  });

  it("'Go-getter' y 'Go for it' NO suman Go aunque la oferta sea técnica (caso real en datos de HN)", () => {
    expect(extract("Go-getter attitude with Python and Docker. Go for it. Go big.")).toEqual(["Docker", "Python"]);
  });

  it("'Go to market' NO suma Go ni siquiera en una oferta técnica (caso real detectado)", () => {
    const text = "React, Node.js, PostgreSQL and Docker. Go to market with us. Go-to-market strategy. Go beyond.";
    const skills = extract(text);
    expect(skills).not.toContain("Go");
    expect(skills).toEqual(expect.arrayContaining(["React", "Node.js", "PostgreSQL", "Docker"]));
    expect(extract("Python, Go, Kubernetes")).toContain("Go");
    expect(extract("Services written in Go and Python")).toContain("Go");
  });

  it("R: una letra con tilde pegada NO la convierte en 'R' suelta (alemán/francés, caso real en Arbeitnow)", () => {
    const base = "Python, SQL, Docker and Kubernetes. ";
    for (const frag of ["Rückfragen", "Rémunération", "Rösrath", "BÄR Automation", "Réseau", "Réaliser", "Rôle"]) {
      expect(extract(base + `${frag} steht Ihnen zur Verfügung.`), frag).not.toContain("R");
    }
  });

  it("R: tampoco '(R2R)', 'UN R171' ni 'R1' (dígitos pegados), pero sí 'Python, R, Rust' y 'Python or R.'", () => {
    const base = "Python, SQL, Docker and Kubernetes. ";
    expect(extract(base + "Record-to-Report (R2R), Order-to-Cash (O2C), UN R171, level R1")).not.toContain("R");
    expect(extract(base + "Kenntnisse in Python, R, Rust, Pyspark oder SQL")).toContain("R");
    expect(extract(base + "a programming language such as Python or R.")).toContain("R");
    expect(extract(base + "Programmiersprachen wie Python, R oder SAS")).toContain("R");
  });

  it("las skills normales siguen aceptando dígitos y letras con tilde alrededor de otros símbolos", () => {
    expect(extract("Python3, HTML5 y Java17 en proyectos de Réseau")).toEqual(expect.arrayContaining(["Python", "HTML", "Java"]));
  });

  it("la exclusión no depende de mayúsculas: 'Go To Market' y 'GO TO MARKET' tampoco suman Go (caso real en Arbeitnow)", () => {
    const base = "React, Node.js, PostgreSQL and Docker. ";
    expect(extract(base + "Working together with Go To Market and Customer Success.")).not.toContain("Go");
    expect(extract(base + "GO TO MARKET teams")).not.toContain("Go");
    expect(extract(base + "Go-To-Market strategy")).not.toContain("Go");
    // y sigue detectando Go de verdad
    expect(extract(base + "Experience with Go To be a plus, and Go.")).toContain("Go");
  });

  it("'React quickly' no suma React en una oferta técnica, pero 'React and Redux' sí", () => {
    expect(extract("Python and Docker. React quickly to incidents.")).not.toContain("React");
    expect(extract("Python and Docker. React and Redux.")).toContain("React");
  });

  it("'R' no se confunde con R&D ni con letras sueltas sin contexto", () => {
    expect(extract("Our R&D team is hiring")).toEqual([]);
    expect(extract("Statistics with R, Python and SQL")).toEqual(expect.arrayContaining(["R", "Python", "SQL"]));
  });

  it("'React' como verbo no cuenta sin contexto técnico", () => {
    expect(extract("React quickly to customer needs and react to feedback.")).toEqual([]);
    expect(extract("Build UIs with React and TypeScript")).toEqual(expect.arrayContaining(["React", "TypeScript"]));
    expect(extract("reactjs developer")).toEqual(["React"]);
  });

  it("React Native se detecta aparte", () => {
    expect(extract("React Native apps")).toContain("React Native");
  });

  it("Swift, Spark y Rust como palabras comunes", () => {
    expect(extract("We offer a swift hiring process. Swift response times.")).toEqual([]);
    expect(extract("Spark joy in our customers")).toEqual([]);
    expect(extract("iOS apps in Swift")).toEqual(expect.arrayContaining(["iOS", "Swift"]));
    expect(extract("Remove the rust from the pipes")).toEqual([]);
  });

  it("detecta C#, C++ y .NET, y ASP.NET cuenta como .NET", () => {
    expect(extract("C# and C++ developer")).toEqual(expect.arrayContaining(["C#", "C++"]));
    expect(extract("Experience with .NET Core")).toContain(".NET");
    expect(extract("ASP.NET MVC")).toContain(".NET");
  });

  it("'Node' suelto solo cuenta con contexto; Node.js siempre", () => {
    expect(extract("Each node in the network")).toEqual([]);
    expect(extract("Node.js")).toEqual(["Node.js"]);
    expect(extract("Node and React with TypeScript")).toContain("Node.js");
  });

  it("'Express' como verbo no se confunde con Express.js", () => {
    expect(extract("Express your ideas freely")).toEqual([]);
    expect(extract("Express.js APIs")).toEqual(["Express.js"]);
  });

  it("respeta el puntuación pegada: paréntesis, comas y punto final", () => {
    expect(extract("(React), Docker. Python;")).toEqual(expect.arrayContaining(["Docker", "Python", "React"]));
  });

  it("alias exactos solo con su capitalización: 'Rails' sí, 'rails' no", () => {
    expect(extract("Ruby on Rails")).toContain("Ruby on Rails");
    expect(extract("guard rails and safety rails")).toEqual([]);
  });
});

describe("isTechJob", () => {
  const base = { title: "Account Manager", category: null, tags: [], skills: [] as string[] };

  it("usa la categoría de la fuente", () => {
    expect(isTechJob({ ...base, category: "Software Development" })).toBe(true);
    expect(isTechJob({ ...base, tags: ["Information Technology"] })).toBe(true);
    expect(isTechJob({ ...base, category: "Customer Service" })).toBe(false);
    expect(isTechJob({ ...base, category: "Writing" })).toBe(false);
  });

  it("usa el título del rol", () => {
    expect(isTechJob({ ...base, title: "Senior Back-end Developer" })).toBe(true);
    expect(isTechJob({ ...base, title: "Full Stack Engineer" })).toBe(true);
    expect(isTechJob({ ...base, title: "Freelance Copywriter" })).toBe(false);
  });

  it("necesita al menos 2 skills si no hay otra señal", () => {
    expect(isTechJob({ ...base, skills: ["SQL"] })).toBe(false);
    expect(isTechJob({ ...base, skills: ["SQL", "Python"] })).toBe(true);
  });
});
