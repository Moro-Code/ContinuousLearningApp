import { mocked } from "ts-jest/utils"
import { Test } from "@nestjs/testing"
import DatabaseService from "./database.service"
import { DatabaseOperations } from "./db"
import ConfigurationService from "../configs/config.service"
import * as path from "path"
import { ClientConfig } from "pg"
import * as dotenv from "dotenv"
import {Action, Log, Link, Category } from "../interfaces/data"
import { DatabaseError, NoDataFound } from "../utils/errors"



dotenv.config()
jest.mock("../configs/config.service")


describe("database service tests", () => {
    let databaseService: DatabaseService
    let configurationService : ConfigurationService
    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
             providers: [ConfigurationService, DatabaseService]
           }
        ).compile()

        databaseService = moduleRef.get<DatabaseService>(DatabaseService)
        configurationService = moduleRef.get<ConfigurationService>(ConfigurationService)
    })
    it("gets ConfigurationService injected", () => {
        expect(databaseService.getConfigService()).toBe(
            configurationService
        )
    })

    it("initializes DatabaseOperations class", () => {
        let db = databaseService.getDb()
        expect(db).toBeInstanceOf(
            DatabaseOperations
        )
        let expectedConfigs: ClientConfig = {
            user: process.env.API_TEST_DATABASE_USER,
            password: process.env.API_TEST_DATABASE_PASSWORD,
            port: parseInt(process.env.API_TEST_DATABASE_PORT) || 5432,
            host: process.env.API_TEST_DATABASE_HOST || "localhost",
            database: process.env.API_TEST_DATABASE_NAME || "continuous_learning_app_test_db"
        }
        expect(db.getConfigs()).toMatchObject(
            expectedConfigs
        )

        expect(db.usingPool()).toBe(true)
        
    })

    describe("data functions", () => {
        let db: DatabaseOperations
        const ddl_path = path.join(__dirname.replace(__filename, ""), "ddl")
        const ddl = DatabaseOperations.load_ddl(ddl_path)
        let spiedOnQuery: jest.SpyInstance
        beforeEach(async () => {
            if ( ! process.env.API_TEST_DATABASE_USER  || ! process.env.API_TEST_DATABASE_PASSWORD){
                throw new Error(
                    "username and password for test database must be provided in environment variable " +
                    "API_TEST_DATABASE_USER and API_TEST_DATABASE_PASSWORD respectively"
                )
            }
            db = databaseService.getDb()
            spiedOnQuery = jest.spyOn(db, "query")
            await db.destroyDatabaseSchema()

            try{
                await db.createDatabaseSchema(ddl)
            }
            catch(error){
                console.log("Failed to initiate test: Could not create schema")
                throw error
            }

        })

        describe ("link CRUD tests", () => {
            it("creates link from data with all fields", async() => {
                let linkData: Link = {
                    url: "http://test.com",
                    title: "This is a test link",
                    language: "en",
                    imageLink: "http://test.com/image",
                    description: "This is a test link with a description"
                }
    
                let id = await databaseService.createLink(linkData)
    
                expect(spiedOnQuery.mock.calls.length).toBe(1)
    
                let data = await db.query("SELECT * FROM links")
                
                expect(data.rowCount).toBe(1)
    
                let returnedLinkData = data.rows[0]
    
                expect(returnedLinkData["url"]).toBe(linkData.url)
                expect(returnedLinkData["title"]).toBe(linkData.title)
                expect(returnedLinkData["language"]).toBe(linkData.language)
                expect(returnedLinkData["description"]).toBe(linkData.description)
                expect(returnedLinkData["image_link"]).toBe(linkData.imageLink)
                expect(returnedLinkData["id"]).toBe(id)
            })
    
            it("creates link data with only core fields", async () => {
                let linkData: Link = {
                    url: "http://test.com",
                    title: "This is a test link",
                    language: "en"
                }
    
                let id = await databaseService.createLink(linkData)
    
                expect(spiedOnQuery.mock.calls.length).toBe(1)
    
                let data = await db.query("SELECT * FROM links")
                expect(data.rowCount).toBe(1)
    
                let returnedLinkData = data.rows[0]
    
                expect(returnedLinkData["url"]).toBe(linkData.url)
                expect(returnedLinkData["title"]).toBe(linkData.title)
                expect(returnedLinkData["language"]).toBe(linkData.language)
                expect(returnedLinkData["id"]).toBe(id)
                expect(returnedLinkData["image_link"]).toBe(null)
                expect(returnedLinkData["description"]).toBe(null)
            })

            it("throws error on bad insert", async () => {
                let linkData: Link = {
                    url: "https://test.com",
                    title: "This is a test link",
                    language: "some invalid language"
                }
                try{
                    await databaseService.createLink(linkData)
                    throw new Error("error should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message.length).toBeGreaterThan(0)
                }
            })

            it("read link by id ", async () => {
                let result = await db.query(
                    `
                    INSERT INTO links ( url, title, language )  VALUES ( 'http://test1.com', 'test site 1', 'en' ) RETURNING created_on;
                    `
                )

                await db.query(
                    `
                    INSERT INTO links ( url, title, language )  VALUES ( 'http://test2.com', 'test site 2', 'en' );
                    `
                )


                let results = await databaseService.readLinkById(1)
        
                expect(results.id).toBe(1)
                expect(results.url).toBe("http://test1.com")
                expect(results.title).toBe("test site 1")
                expect(results.language).toBe("en")
                expect(results.createdOn.toISOString()).toBe(result.rows[0]["created_on"].toISOString())
                
            } )

            it("throws DatabaseError on read error in read link by id", async () => {
                spiedOnQuery.mockImplementationOnce( (...args ) => {
                    throw new Error("Some database error that occured")
                })

                try{
                    await databaseService.readLinkById(1)
                    throw new Error("error should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message).toBe("Some database error that occured")
                }
            } )

            it("throws NoDataFound when there is no rows for read link by id", async () => {
                try{
                    await databaseService.readLinkById(1)
                }catch(e){
                    expect(e).toBeInstanceOf(NoDataFound)
                    expect(e.message).toBe("No links found for id 1")
                }
            })

            it("read links by url ", async () => {
                let result = await db.query(
                    `INSERT INTO LINKS (url, language, title) VALUES ('https://testing.com', 'en', 'this is a title') RETURNING id, created_on;
                    `
                )

                await db.query(
                    `INSERT INTO LINKS (url, language, title ) VALUES ('https://testing1.com', 'en', 'this is a title 2')`
                )

                let id = result.rows[0]["id"]
                let created_on: Date = result.rows[0]["created_on"]

                let serviceResults = await databaseService.readLinkByURL("https://testing.com")

                expect(serviceResults.id).toBe(id)
                expect(serviceResults.url).toBe("https://testing.com")
                expect(serviceResults.createdOn.toISOString()).toBe(created_on.toISOString())

            })

            it("throws DatabaseError on read error in read link by url", async () => {
                spiedOnQuery.mockImplementationOnce( (...args ) => {
                    throw new Error("Some database error that occured")
                })

                try {
                    await databaseService.readLinkByURL("https://someurl.com")
                    throw new Error("error should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message.length).toBeGreaterThan(0)
                }
            })

            it("throws NoDataFound when there is no rows for read link by url", async () => {
                try {
                    await databaseService.readLinkByURL("https://thisurldoesnotexist.com")
                    throw new Error("error should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(NoDataFound)
                    expect(e.message).toBe("No links found for url https://thisurldoesnotexist.com")
                }
            })

            it("read links ordered by created_on ascending by default", async () => {
                
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test1.com', 'en', 'test site 1');"
                    
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test2.com', 'en', 'test site 2');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test3.com', 'en', 'test site 3');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test4.com', 'en', 'test site 4');"
                )

                let dbRows = await db.query(
                    "SELECT * FROM links ORDER BY created_on ASC"
                )

                expect(dbRows.rowCount).toBe(4)

                let results = await databaseService.readLinks()

                for (let row in results){
                    expect(results[row].id).toBe(
                        dbRows.rows[row]["id"]
                    )
                    expect(results[row].url).toBe(
                        dbRows.rows[row]["url"]
                    )
                    expect(results[row].createdOn.toISOString()).toBe(
                        dbRows.rows[row]["created_on"].toISOString()
                    )
                }

            })

            it("read links orderd by created_on descending if specified", async () => {
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test1.com', 'en', 'test site 1');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test2.com', 'en', 'test site 2');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test3.com', 'en', 'test site 3');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test4.com', 'en', 'test site 4');"
                )


                let dbRows = await db.query(
                    "SELECT * FROM links ORDER BY created_on DESC"
                )

                expect(dbRows.rowCount).toBe(4)
                
                let results = await databaseService.readLinks({
                    order: "desc"
                })

                for (let row in results){
                    expect(results[row].id).toBe(
                        dbRows.rows[row]["id"]
                    )
                    expect(results[row].url).toBe(
                        dbRows.rows[row]["url"]
                    )
                    expect(results[row].createdOn.toISOString()).toBe(
                        dbRows.rows[row]["created_on"].toISOString()
                    )
                }

            })

            it("throws error for invalid order option in read links", async () => {
                try{
                    await databaseService.readLinks({
                        order: "bad order"
                    })
                    throw new Error("it didn't throw an error")
                }catch(e){
                    expect(e.message).toBe("order must have value of either asc or desc")
                }
            })

            it("allows limits in read links", async () => {
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test1.com', 'en', 'test site 1');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test2.com', 'en', 'test site 2');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test3.com', 'en', 'test site 3');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test4.com', 'en', 'test site 4');"
                )

                let dbRows = await db.query(
                    "SELECT * FROM links ORDER BY created_on ASC LIMIT 2"
                )

                let results =  await databaseService.readLinks({
                    limit: 2
                })

                for (let row in results){
                    expect(results[row].id).toBe(
                       dbRows.rows[row]["id"]
                    )
                    expect(results[row].url).toBe(
                        dbRows.rows[row]["url"]
                    )
                    expect(results[row].createdOn.toISOString()).toBe(
                        dbRows.rows[row]["created_on"].toISOString()
                    )
                }
                
            })

            it("allows limits and offsets in read links", async () => {
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test1.com', 'en', 'test site 1');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test2.com', 'en', 'test site 2');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test3.com', 'en', 'test site 3');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test4.com', 'en', 'test site 4');"
                )

                let dbRows = await db.query(
                    "SELECT * FROM links ORDER BY created_on ASC LIMIT 2 OFFSET 2"
                )

                let results =  await databaseService.readLinks({
                    limit: 2,
                    offset: 2
                })

                for (let row in results){
                    expect(results[row].id).toBe(
                       dbRows.rows[row]["id"]
                    )
                    expect(results[row].url).toBe(
                        dbRows.rows[row]["url"]
                    )
                    expect(results[row].createdOn.toISOString()).toBe(
                        dbRows.rows[row]["created_on"].toISOString()
                    )
                }
            })

            it("allows descending order with limit and offset for read links", async () => {
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test1.com', 'en', 'test site 1');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test2.com', 'en', 'test site 2');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test3.com', 'en', 'test site 3');"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title ) VALUES ('https://test4.com', 'en', 'test site 4');"
                )

                let dbRows = await db.query(
                    "SELECT * FROM links ORDER BY created_on DESC LIMIT 2 OFFSET 2"
                )

                let results =  await databaseService.readLinks({
                    order: "desc",
                    limit: 2,
                    offset: 2
                })

                for (let row in results){
                    expect(results[row].id).toBe(
                       dbRows.rows[row]["id"]
                    )
                    expect(results[row].url).toBe(
                        dbRows.rows[row]["url"]
                    )
                    expect(results[row].createdOn.toISOString()).toBe(
                        dbRows.rows[row]["created_on"].toISOString()
                    )
                }

            })

            it("throws DatabaseError on read error in read links", async () => {
                spiedOnQuery.mockImplementationOnce((...args) => {
                    throw new Error("an error was thrown")
                })

                try{
                    await databaseService.readLinks()
                    throw new Error("DatabaseError was supposed to be thrown ")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message).toBe("an error was thrown")
                }
            })

            it("returns an empty list on no data for read links", async () => {
                let results = await databaseService.readLinks()
                expect(results).toMatchObject([])
            })

            it("updates link by id", async () => {
                await db.query(
                    "INSERT INTO links (url, language, title) VALUES " +
                    "( 'http://test.com', 'en', 'test site' ) "
                )

                await db.query(
                    "INSERT INTO links (url, language, title ) VALUES " +
                    "( 'http://test2.com', 'en', 'test site 2' )"
                )

                let result = await databaseService.updateLinkById(
                    2, 
                    {
                        title: "This is a new title",
                        description: "This is a new description",
                        imageLink: "This is a new image link",
                        language: "fr"
                    }
                )

                let dbResult = await db.query("SELECT * FROM links WHERE id = 2")

                expect(result.id).toBe(dbResult.rows[0]["id"])
                expect(result.url).toBe(dbResult.rows[0]["url"])
                expect(result.title).toBe(dbResult.rows[0]["title"])
                expect(result.description).toBe(dbResult.rows[0]["description"])
                expect(result.language).toBe(dbResult.rows[0]["language"])
                expect(result.updatedOn.toISOString()).toBe(
                    dbResult.rows[0]["updated_on"].toISOString()
                )
            })
            it("throws NoDataFound when the row does not exist for update by id", async () => {
                try{
                    await databaseService.updateLinkById(
                        1,
                        {
                            title: "some title"
                        }
                    )
                    throw new Error("NoDataFound error should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(NoDataFound)
                    expect(e.message).toBe(
                        "link cannot be found for id 1"
                    )
                }
            })

            it ("throws DatabaseError on update error for update by id", async () => {
                spiedOnQuery.mockImplementationOnce((...args) => {
                    throw new Error("an error is thrown by db client")
                })
                try {
                    await databaseService.updateLinkById(1, {
                        title: "hello"
                    })
                    throw new Error("DatabaseError should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message).toBe("an error is thrown by db client")
                }
                spiedOnQuery.mockRestore()
            })

            it("updates links by url", async () => {
                await db.query(
                    "INSERT INTO links (url, language, title) VALUES " +
                    "( 'http://test.com', 'en', 'test site' ) "
                )

                await db.query(
                    "INSERT INTO links (url, language, title ) VALUES " +
                    "( 'http://test2.com', 'en', 'test site 2' )"
                )

                let result = await databaseService.updateLinkByURL(
                    "http://test2.com", 
                    {
                        title: "This is a new title",
                        description: "This is a new description",
                        imageLink: "This is a new image link",
                        language: "fr"
                    }
                )

                let dbResult = await db.query("SELECT * FROM links WHERE id = 2")

                expect(result.id).toBe(dbResult.rows[0]["id"])
                expect(result.url).toBe(dbResult.rows[0]["url"])
                expect(result.title).toBe(dbResult.rows[0]["title"])
                expect(result.description).toBe(dbResult.rows[0]["description"])
                expect(result.language).toBe(dbResult.rows[0]["language"])
                expect(result.updatedOn.toISOString()).toBe(
                    dbResult.rows[0]["updated_on"].toISOString()
                )

            })

            it("throws NoDataFound when the row does not exist for update by url", async () => {
                try{
                    await databaseService.updateLinkByURL(
                        "https://somelinkthatdoesntexist",
                        {
                            title: "some title"
                        }
                    )
                    throw new Error("NoDataFound error should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(NoDataFound)
                    expect(e.message).toBe(
                        "link cannot be found for url https://somelinkthatdoesntexist"
                    )
                }
            })

            it("throws DatabaseError on update error for update by url", async () => {
                spiedOnQuery.mockImplementationOnce((...args) => {
                    throw new Error("an error is thrown by db client")
                })
                try {
                    await databaseService.updateLinkByURL("https://someurl", {
                        title: "hello"
                    })
                    throw new Error("DatabaseError should have been thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message).toBe("an error is thrown by db client")
                }
                spiedOnQuery.mockRestore()
            })

            it("delete link by id", async () => {

                await db.query(
                    "INSERT INTO links (url, language, title) VALUES ('http://sometestingsite.com', 'en','hello')"
                )
                await db.query(
                    "INSERT INTO links (url, language, title ) VALUES ('http://someothertesting.com', 'en', 'title')"
                )


                await databaseService.deleteLinkById(2)

                let results = await db.query(
                    "SELECT * FROM links"
                )

                expect(results.rowCount).toBe(1)

                expect(results.rows[0]["url"]).toBe("http://sometestingsite.com")

            })

            it("throws DatabaseError on delete error for deleteLinkById", async() => {
                spiedOnQuery.mockImplementationOnce((...args) => {
                    throw new Error("error when deleting row")
                })

                try{
                    await databaseService.deleteLinkById(2)
                    throw new Error("should have thrown DatabasError")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message).toBe("error when deleting row")
                }
            })

            it("delete link by url", async () => {
                await db.query(
                    "INSERT INTO links (url, language, title) VALUES ('http://sometestingsite.com', 'en','hello')"
                )
                await db.query(
                    "INSERT INTO links (url, language, title ) VALUES ('http://someothertesting.com', 'en', 'title')"
                )


                await databaseService.deleteLinkByURL('http://someothertesting.com')

                let results = await db.query(
                    "SELECT * FROM links"
                )

                expect(results.rowCount).toBe(1)

                expect(results.rows[0]["url"]).toBe("http://sometestingsite.com")

            })

            it("search links using full text search ", async () => {
                await db.query(
                    "INSERT INTO links (url, language, title, description ) " +
                    "VALUES ('https://test.com', 'en', 'testing your applications', " + 
                    "'A site to find how you can test your applications across many different frameworks')"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title, description ) " +
                    "VALUES ( 'https://javascript.com', 'en', 'Javascript Information Site', " +
                    "'Ever wonder how to write good clean javascript, this is the site for you')"
                )
                await db.query(
                    "INSERT INTO links ( url, language, title, description ) " + 
                    "VALUES ( 'https://apprendrelefrancais', 'fr', 'Apprenez la langue française', " +
                    "'Vous voulez améliorer votre français au quotidien. Ceci est le site pour vous!')"
                )

                let englishDBResults = await db.query(
                    'SELECT * FROM links WHERE ftx_data @@ websearch_to_tsquery(\'en\', \'testing site\') AND language = \'en\''
                )
                let frenchDBResults = await db.query(
                    'SELECT * FROM links WHERE ftx_data @@ websearch_to_tsquery(\'fr\', \'apprenez française\') AND language = \'fr\''
                ) 

                expect(englishDBResults.rowCount).toBeGreaterThan(0)
                expect(frenchDBResults.rowCount).toBeGreaterThan(0)

                let englishResults: Link[] = await databaseService.searchLinks("testing site", "en")
                let frenchResults: Link[] = await databaseService.searchLinks("apprenez française", "fr")

                expect(englishResults.length).toBe(englishDBResults.rowCount)
                expect(frenchResults.length).toBe(frenchDBResults.rowCount)

                for (let row in englishResults){
                    expect(
                        englishResults[row].id
                    ).toBe(englishDBResults.rows[row]["id"])
                    expect(
                        englishResults[row].url
                    ).toBe(englishDBResults.rows[row]["url"])
                }

                for (let row in frenchResults){
                    expect(
                        frenchResults[row].id
                    ).toBe(frenchDBResults.rows[row]["id"])
                    expect(
                        frenchResults[row].url
                    ).toBe(frenchDBResults.rows[row]["url"])
                }
            })

            it("search links returns empty list on no data", async () => {
                let results = await databaseService.searchLinks("there is no links", "en")

                expect(results).toMatchObject(
                    []
                )
            })

            it("search links throws error on incorrect language input", async () => {
                try{
                    await databaseService.searchLinks("an example search", "ru")
                    throw new Error("an error was not thrown")
                }catch(e){
                    expect(e.message).toBe("Invalid language 'ru', language must be either 'en' or 'fr'")
                }
            })

            it("search links throws DatabaseError on read error", async () => {
                spiedOnQuery.mockImplementationOnce((...args) => {
                    throw new Error("an error by the db was thrown")
                })

                try{
                    await databaseService.searchLinks("an example search", "en")
                    throw new Error("DatabaseError was not thrown")
                }catch(e){
                    expect(e).toBeInstanceOf(DatabaseError)
                    expect(e.message).toBe("an error by the db was thrown")
                }
            })
            
            
        })

        afterEach(async () => {
            await db.destroyDatabaseSchema()
            await db.endPool()
            spiedOnQuery.mockRestore()
        })

    })
    
})